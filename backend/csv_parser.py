"""CSV 파서: CSV 파일을 래더 데이터 구조로 변환"""


def parse_csv(csv_text: str) -> dict:
    """CSV 텍스트를 파싱하여 meta, ladder, variables로 분리"""
    lines = [l.strip() for l in csv_text.split('\n') if l.strip()]
    section = ''
    meta = {}
    ladder_rows = []
    variables = {}

    for line in lines:
        if line == '[meta]':
            section = 'meta'
            continue
        if line == '[ladder]':
            section = 'ladder'
            continue
        if line == '[variables]':
            section = 'variables'
            continue

        # 헤더 스킵
        if line.startswith('key,') or line.startswith('rung,') or line.startswith('name,'):
            continue

        if section == 'meta':
            parts = line.split(',', 1)
            if len(parts) == 2:
                meta[parts[0]] = parts[1]
        elif section == 'ladder':
            ladder_rows.append(line.split(','))
        elif section == 'variables':
            parts = line.split(',')
            if parts[0]:
                variables[parts[0]] = {
                    'comment': parts[1] if len(parts) > 1 else '',
                    'preset': parts[2] if len(parts) > 2 else ''
                }

    return {
        'meta': meta,
        'ladder_rows': ladder_rows,
        'variables': variables
    }


def build_rungs(parsed: dict) -> list:
    """파싱된 래더 데이터를 렁 구조로 변환

    Returns:
        [
            {
                'id': 0,
                'comment': '모터 자기유지',
                'main': {
                    'steps': [{'family': 'contact_a', 'var': 'X0'}, ...],
                    'vlines': [2, 5]  # v-down 위치
                },
                'branches': [
                    {
                        'steps': [...],
                        'vlines': [2, 5]  # v-up 위치
                    }
                ]
            }
        ]
    """
    step_count = int(parsed['meta'].get('stepCount', '12'))
    output_col = int(parsed['meta'].get('outputCol', '11'))

    rungs = []
    current_rung = None

    for row in parsed['ladder_rows']:
        rung_num = int(row[0])
        row_type = row[1]
        comment = row[2] if len(row) > 2 else ''

        if row_type == 'main':
            current_rung = {
                'id': rung_num,
                'comment': comment,
                'main': _parse_row_steps(row, step_count),
                'branches': []
            }
            rungs.append(current_rung)
        elif row_type == 'branch' and current_rung is not None:
            current_rung['branches'].append(_parse_row_steps(row, step_count))

    return rungs


def _parse_row_steps(row: list, step_count: int) -> dict:
    """CSV 행에서 step과 vertical line 정보를 추출"""
    steps = []
    vlines = []

    col_idx = 3  # row[3]부터 데이터
    for i in range(step_count):
        step_val = row[col_idx] if col_idx < len(row) else ''
        col_idx += 1

        step = _parse_step(step_val)
        steps.append(step)

        # vertical line (마지막 step 제외)
        if i < step_count - 1:
            v_val = row[col_idx] if col_idx < len(row) else ''
            col_idx += 1
            if v_val in ('d', 'u'):
                vlines.append({'col': i, 'dir': v_val})

    return {'steps': steps, 'vlines': vlines}


def _parse_step(step_val: str) -> dict | None:
    """step 값 파싱: 'contact_a:X0' → {'family': 'contact_a', 'var': 'X0'}"""
    if not step_val or step_val == 'line':
        return None

    parts = step_val.split(':')
    family = parts[0]
    var_name = parts[1] if len(parts) > 1 else ''

    return {
        'family': family,
        'var': var_name
    }
