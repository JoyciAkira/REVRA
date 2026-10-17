#!/usr/bin/env python3
"""
Genera dataset sintetico completo per studio cognitivo REVRA (n=60 × 6 task × 3 tool = 1080 record).
Standalone: nessun subprocess overhead, genera direttamente i CSV in memoria.
"""
import csv
import math
import random
from datetime import datetime, timezone
from pathlib import Path

BENCH_DIR = Path(__file__).parent
DATA_DIR = BENCH_DIR / "cognitive_study" / "data"

# Parametri realistici basati su letteratura (Fakhoury ICPC 2018, mouse kinematics IJHCI 2021)
TASK_PARAMS = {
    "aes_encrypt_easy": {"base_time": 300, "sd_pct": 0.3, "tlx_base": 40},
    "buffer_overflow_easy": {"base_time": 450, "sd_pct": 0.3, "tlx_base": 45},
    "obfuscated_sort_hard": {"base_time": 900, "sd_pct": 0.3, "tlx_base": 65},
    "race_condition_hard": {"base_time": 1200, "sd_pct": 0.3, "tlx_base": 70},
    "packed_malware_expert": {"base_time": 1800, "sd_pct": 0.3, "tlx_base": 80},
    "cfg_navigation_expert": {"base_time": 2400, "sd_pct": 0.3, "tlx_base": 85},
}

TOOL_EFFECTS = {
    "REVRA": {"time_multiplier": 0.6, "tlx_reduction": 15},  # -40% tempo, -15 TLX
    "Ghidra": {"time_multiplier": 1.0, "tlx_reduction": 0},
    "IDA": {"time_multiplier": 0.95, "tlx_reduction": 5},
}

def compute_mouse_entropy(n_samples: int, cognitive_load: float) -> float:
    """Simula mouse entropy correlato al carico cognitivo (r ≈ -0.6 con NASA-TLX)."""
    # Carico alto → entropy bassa (movimenti più regolari/prevedibili sotto stress)
    base_entropy = 2.0 - (cognitive_load / 100.0) * 1.5
    noise = random.gauss(0, 0.2)
    return max(0.1, base_entropy + noise)

def generate_record(participant_id: str, task_id: str, tool: str, difficulty: str) -> dict:
    """Genera un singolo record sintetico realistico."""
    params = TASK_PARAMS.get(task_id, {"base_time": 600, "sd_pct": 0.3, "tlx_base": 50})
    tool_effect = TOOL_EFFECTS.get(tool, {"time_multiplier": 1.0, "tlx_reduction": 0})
    
    # Completion time con variabilità individuale
    base_time = params["base_time"] * tool_effect["time_multiplier"]
    sd = base_time * params["sd_pct"]
    completion_time = max(30, random.gauss(base_time, sd))
    
    # NASA-TLX score
    tlx_base = params["tlx_base"] - tool_effect["tlx_reduction"]
    nasa_tlx = max(0, min(100, random.gauss(tlx_base, 12)))
    
    # Mouse entropy (correlato negativamente con TLX)
    mouse_entropy = compute_mouse_entropy(300, nasa_tlx)
    
    # Keystroke dynamics
    mean_dwell = random.gauss(80, 20)
    std_dwell = random.gauss(25, 8)
    mean_flight = random.gauss(120, 30)
    std_flight = random.gauss(35, 10)
    total_keystrokes = int(completion_time / 2)  # ~1 keystroke ogni 2 secondi
    
    # Accuracy (70-95% baseline, +10% con REVRA)
    accuracy_base = 0.75 if tool != "REVRA" else 0.85
    accuracy = 1 if random.random() < accuracy_base else 0
    
    return {
        "participant_id": participant_id,
        "task_id": task_id,
        "tool": tool,
        "difficulty": difficulty,
        "completion_time_seconds": round(completion_time, 2),
        "accuracy": accuracy,
        "nasa_tlx_raw_score": round(nasa_tlx, 2),
        "nasa_tlx_mental": int(max(0, min(100, nasa_tlx + random.gauss(0, 8)))),
        "nasa_tlx_physical": int(max(0, min(100, 20 + random.gauss(0, 5)))),
        "nasa_tlx_temporal": int(max(0, min(100, nasa_tlx + random.gauss(0, 6)))),
        "nasa_tlx_performance": int(max(0, min(100, 100 - nasa_tlx + random.gauss(0, 10)))),
        "nasa_tlx_effort": int(max(0, min(100, nasa_tlx + random.gauss(0, 10)))),
        "nasa_tlx_frustration": int(max(0, min(100, nasa_tlx - 10 + random.gauss(0, 8)))),
        "mouse_entropy": round(mouse_entropy, 4),
        "mean_dwell_ms": round(mean_dwell, 2),
        "std_dwell_ms": round(std_dwell, 2),
        "mean_flight_ms": round(mean_flight, 2),
        "std_flight_ms": round(std_flight, 2),
        "total_keystrokes": total_keystrokes,
        "pupil_diameter_mean": round(random.gauss(3.5, 0.5), 2) if random.random() > 0.3 else None,
        "timestamp_utc": datetime.now(timezone.utc).isoformat()
    }

def main():
    print("Generazione dataset sintetico completo (n=60 × 6 task × 3 tool = 1080 record)...")
    
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    participants = [f"P{i:03d}" for i in range(1, 61)]
    tasks = [
        ("aes_encrypt_easy", "easy"),
        ("buffer_overflow_easy", "easy"),
        ("obfuscated_sort_hard", "hard"),
        ("race_condition_hard", "hard"),
        ("packed_malware_expert", "expert"),
        ("cfg_navigation_expert", "expert"),
    ]
    tools = ["REVRA", "Ghidra", "IDA"]
    
    all_records = []
    for pid in participants:
        for task_id, difficulty in tasks:
            for tool in tools:
                record = generate_record(pid, task_id, tool, difficulty)
                all_records.append(record)
    
    # Scrivi tutti i record in un unico CSV aggregato
    output_file = DATA_DIR / "synthetic_dataset_complete.csv"
    fieldnames = list(all_records[0].keys())
    
    with open(output_file, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_records)
    
    print(f"Dataset generato: {len(all_records)} record in {output_file}")
    print(f"Partecipanti: {len(participants)}, Task: {len(tasks)}, Tool: {len(tools)}")
    print(f"Pronto per analisi statistica H1/H2/H3")

if __name__ == "__main__":
    main()