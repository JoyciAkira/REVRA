import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { tokenIssueSchema } from '@revra/contracts';
import { JwtAuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  @Inject(JwtAuthService)
  private readonly auth!: JwtAuthService;

  @Post('token')
  @HttpCode(HttpStatus.OK)
  issue(@Body() body: unknown): { token: string; expiresAt: string } {
    const { tenantId, role, ttlSeconds } = tokenIssueSchema.parse(body);
    return this.auth.issue(tenantId, role, ttlSeconds);
  }
}
