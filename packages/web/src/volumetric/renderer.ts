/**
 * Renderer volumetrico con progressive enhancement (PRD §3.2 + mitigation
 * §10): backend WebGPU quando il browser lo espone, fallback canvas 2D
 * immediato altrimenti (o su qualsiasi errore GPU). Stessa scena, stessa
 * semantica: punti = risultati, y = livello di evidenza.
 *
 * Il surface WebGPU usato è dichiarato in interfacce minime locali (il
 * progetto non dipende da @webgpu/types); i cast ai confini sono il unico
 * punto non verificato dal compilatore, motivati e centralizzati qui.
 */

export interface VolumePoint {
  x: number;
  y: number;
  z: number;
  intensity: number;
  resultId: string;
  state: string;
}

export type RenderBackend = 'webgpu' | 'canvas2d';

interface GpuAdapterLike {
  requestDevice(): Promise<GpuDeviceLike>;
}
interface GpuLike {
  requestAdapter(): Promise<GpuAdapterLike | null>;
  getPreferredCanvasFormat(): string;
}
interface GpuCanvasContextLike {
  configure(config: { device: GpuDeviceLike; format: string; alphaMode: string }): void;
  getCurrentTexture(): { createView(): unknown };
}
interface GpuBufferLike {
  // handle opaco
}
interface GpuRenderPassLike {
  setPipeline(pipeline: unknown): void;
  setVertexBuffer(slot: number, buffer: GpuBufferLike): void;
  draw(count: number): void;
  end(): void;
}
interface GpuCommandEncoderLike {
  beginRenderPass(descriptor: unknown): GpuRenderPassLike;
  finish(): unknown;
}
interface GpuDeviceLike {
  createRenderPipeline(descriptor: unknown): unknown;
  createShaderModule(descriptor: unknown): unknown;
  createBuffer(descriptor: unknown): GpuBufferLike;
  createCommandEncoder(): GpuCommandEncoderLike;
  queue: {
    writeBuffer(buffer: GpuBufferLike, offset: number, data: Float32Array): void;
    submit(commands: unknown): void;
  };
}

const LEVEL_COLOR: Record<string, [number, number, number]> = {
  L0: [110, 110, 110],
  L1: [180, 130, 30],
  L2: [40, 120, 190],
  L3: [25, 150, 90],
  DISPUTED: [200, 60, 60],
  UNKNOWN: [120, 120, 130],
  UNSUPPORTED: [120, 120, 130],
};

export async function renderVolumetric(
  canvas: HTMLCanvasElement,
  points: VolumePoint[],
): Promise<RenderBackend> {
  // Cast motivato: WebGPU non è nei tipi DOM del progetto (niente @webgpu/types).
  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
  if (gpu) {
    try {
      await renderWebGpu(canvas, points, gpu);
      return 'webgpu';
    } catch {
      // Fallback immediato: il volumetrico non è mai un requisito di accesso.
    }
  }
  renderCanvas2D(canvas, points);
  return 'canvas2d';
}

async function renderWebGpu(canvas: HTMLCanvasElement, points: VolumePoint[], gpu: GpuLike): Promise<void> {
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error('no gpu adapter');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu') as GpuCanvasContextLike | null;
  if (!context) throw new Error('no webgpu context');
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  // Un quad per punto (2 triangoli), NDC calcolato sulla CPU:
  // y = livello di evidenza, z → dimensione, intensità → opacità.
  const vertexData: number[] = [];
  for (const p of points) {
    const cx = p.x * 2 - 1;
    const cy = 1 - (p.y / 3) * 2;
    const size = 0.02 + p.intensity * 0.03 + p.z * 0.01;
    const [r, g, b] = LEVEL_COLOR[p.state] ?? LEVEL_COLOR.UNKNOWN;
    const quad: Array<[number, number]> = [
      [-size, -size], [size, -size], [size, size],
      [-size, -size], [size, size], [-size, size],
    ];
    for (const [ox, oy] of quad) {
      vertexData.push(cx + ox, cy + oy, r / 255, g / 255, b / 255, p.intensity);
    }
  }
  const vertices = new Float32Array(vertexData);
  if (vertices.length === 0) throw new Error('empty scene');

  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: 0x20 | 0x8, // VERTEX | COPY_DST
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertices);

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({
        code: `
          struct Out { @builtin(position) pos: vec4f, @location(0) color: vec4f };
          @vertex fn vs(@location(0) pos: vec2f, @location(1) color: vec3f, @location(2) alpha: f32) -> Out {
            var out: Out;
            out.pos = vec4f(pos, 0.0, 1.0);
            out.color = vec4f(color, alpha);
            return out;
          }`,
      }),
      entryPoint: 'vs',
      buffers: [
        {
          arrayStride: 6 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x3' },
            { shaderLocation: 2, offset: 20, format: 'float32' },
          ],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({
        code: `
          @fragment fn fs(@location(0) color: vec4f) -> @location(0) vec4f {
            return vec4f(color.rgb * color.a, color.a);
          }`,
      }),
      entryPoint: 'fs',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const commandEncoder = device.createCommandEncoder();
  const pass = commandEncoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.03, g: 0.03, b: 0.04, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.draw(vertices.length / 6);
  pass.end();
  device.queue.submit(commandEncoder.finish());
}

function renderCanvas2D(canvas: HTMLCanvasElement, points: VolumePoint[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#08080a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Griglia di profondità: un piano per livello L0..L3.
  ctx.strokeStyle = '#1c1c22';
  for (let level = 0; level <= 3; level += 1) {
    const y = (level / 3) * canvas.height;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height - y);
    ctx.lineTo(canvas.width, canvas.height - y);
    ctx.stroke();
  }
  for (const p of points) {
    const [r, g, b] = LEVEL_COLOR[p.state] ?? LEVEL_COLOR.UNKNOWN;
    const size = 3 + p.intensity * 4 + p.z * 3;
    ctx.globalAlpha = 0.35 + p.intensity * 0.65;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(
      p.x * canvas.width - size / 2,
      canvas.height - (p.y / 3) * canvas.height - size / 2,
      size,
      size,
    );
  }
  ctx.globalAlpha = 1;
}
