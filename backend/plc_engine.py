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
        self.elapsed_ms += scan_time_ms
        if self.elapsed_ms >= self.preset_ms:
            self.done = True

    def reset(self):
        self.running = False
        self.elapsed_ms = 0
        self.done = False


class PLCEngine:
    def __init__(self, scan_time_ms=100):
        self.scan_time_ms = scan_time_ms
        self.io = {}        # I/O 상태: {변수명: bool}
        self.timers = {}    # 타이머: {변수명: Timer}
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

    def init_io(self, variables: list):
        """I/O 초기화"""
        for var in variables:
            if var not in self.io:
                self.io[var] = False
            prefix = var[0] if var else ''
            if prefix == 'T' and var not in self.timers:
                self.timers[var] = Timer()

    def set_input(self, var: str, value: bool):
        """외부 입력 설정 (X 변수)"""
        self.io[var] = value

    def scan_once(self):
        """1 스캔 실행"""
        if self.scan_func:
            self.scan_func(self.io, self.timers)
            self.scan_count += 1

    def get_io_state(self) -> dict:
        """현재 I/O 상태 반환"""
        return {
            'io': dict(self.io),
            'scan_count': self.scan_count
        }

    def start(self):
        """스캔 루프 시작"""
        self.running = True
        self.scan_count = 0

    def stop(self):
        """스캔 루프 중지"""
        self.running = False
