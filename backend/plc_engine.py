"""PLC 엔진: 생성된 코드를 실행하는 스캔 루프"""

import time
import importlib.util
import tempfile
import os


class Timer:
    """On-Delay Timer (TON)"""
    def __init__(self, preset_ms=3000):
        self.preset_ms = preset_ms
        self.elapsed_ms = 0
        self.done = False
        self.running = False

    def run(self, scan_time_ms=100):
        self.running = True
        if not self.done:
            self.elapsed_ms += scan_time_ms
            if self.elapsed_ms >= self.preset_ms:
                self.elapsed_ms = self.preset_ms
                self.done = True

    def reset(self):
        self.running = False
        self.elapsed_ms = 0
        self.done = False


class Counter:
    """Count Up Counter (CTU)"""
    def __init__(self, preset=10):
        self.preset = preset
        self.count = 0
        self.done = False
        self._prev_input = False

    def update(self, input_on: bool):
        """상승 엣지 감지하여 카운트"""
        if input_on and not self._prev_input and not self.done:
            self.count += 1
            if self.count >= self.preset:
                self.done = True
        self._prev_input = input_on

    def reset(self):
        self.count = 0
        self.done = False
        self._prev_input = False


class PLCEngine:
    def __init__(self, scan_time_ms=100):
        self.scan_time_ms = scan_time_ms
        self.io = {}        # I/O 상태: {변수명: bool}
        self.timers = {}    # 타이머: {변수명: Timer}
        self.counters = {}  # 카운터: {변수명: Counter}
        self.scan_func = None
        self.running = False
        self.scan_count = 0

    def load_code(self, code_str: str):
        """생성된 Python 코드를 로드"""
        # 임시 파일로 저장 후 import
        tmp = tempfile.NamedTemporaryFile(
            mode='w', suffix='.py', delete=False, encoding='utf-8'
        )
        tmp.write(code_str)
        tmp.close()

        try:
            spec = importlib.util.spec_from_file_location('ladder_logic', tmp.name)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            self.scan_func = module.scan_cycle
        finally:
            os.unlink(tmp.name)

    def init_io(self, variables: dict):
        """I/O 초기화

        Args:
            variables: {변수명: {'comment': str, 'preset': str}}
        """
        for var, info in variables.items():
            if var not in self.io:
                self.io[var] = False
            prefix = var[0] if var else ''
            preset = int(info.get('preset', 0) or 0) if isinstance(info, dict) else 0
            if prefix == 'T' and var not in self.timers:
                self.timers[var] = Timer(preset_ms=preset if preset > 0 else 3000)
            if prefix == 'C' and var not in self.counters:
                self.counters[var] = Counter(preset=preset if preset > 0 else 10)

    def set_input(self, var: str, value: bool):
        """외부 입력 설정 (X 변수)"""
        self.io[var] = value

    def scan_once(self):
        """1 스캔 실행"""
        if self.scan_func:
            self.scan_func(self.io, self.timers, self.counters)
            self.scan_count += 1

    def get_io_state(self) -> dict:
        """현재 I/O 상태 반환"""
        values = {}
        for var, timer in self.timers.items():
            values[var] = timer.elapsed_ms
        for var, counter in self.counters.items():
            values[var] = counter.count
        return {
            'io': dict(self.io),
            'values': values,
            'scan_count': self.scan_count
        }

    def start(self):
        """스캔 루프 시작"""
        self.running = True
        self.scan_count = 0

    def stop(self):
        """스캔 루프 중지"""
        self.running = False
