# 자동 배치 규칙 (Placement Rules)

래더 에디터에서 컴포넌트를 배치할 때 적용되야하는 자동 배치 규칙입니다.
모든 배치(`placeComponent`, `insert`, `paste`)에 동일한 규칙이 적용됩니다.

## Step 구조

```
|     Load    |                Steps                  |     |
| Comment | # | 0 | 1 | 2 | ... | 10 | 11 (outputCol) | COM |
```

- Step 0~10: 입력/접점/RST 영역
- Step 11 (outputCol): 출력 전용 (Output_Y, Output_Timer, Output_Counter, Function_Memory, Output_RST)
- 각 step은 `step-name(20px) + step-param(20px) + step-symbol(50px) + step-comment(40px)` = 130px

## 배치 규칙

### 1. Output 계열 → outputCol(11번)에만 배치

```
Output_Y, Output_Timer, Output_Counter, Function_Memory, Output_RST
→ 항상 step 11에 배치
→ 기존 output을 교체
→ 삭제 시 Output_Basic으로 복원
```

### 2. Input/Contact 계열 → 왼쪽부터 정렬

```
PB_A, PB_B, Contact_Memory_A/B, Contact_Timer_A/B, Contact_Counter_A/B, Contact_Y_A/B
→ 클릭한 셀 기준 범위 내에서 가장 왼쪽 빈 셀에 배치
```

### 3. Vertical Line에 의한 범위 제한

Vertical line이 배치 범위의 경계 역할을 합니다.

```
메인 행: 모든 vertical-line이 경계
Branch 행: v-up만 경계 (v-down은 무시)
```

```
예시:
|     Steps 0~10      | Step 11  |
|──| X0 |──┬──| X1 |──┬──( Y0 )──|
|          │          │          |
|          └──       ─┘          |

클릭 위치가 step 3이면:
- 왼쪽 경계: 가장 가까운 왼쪽 vertical line + 1
- 오른쪽 경계: 가장 가까운 오른쪽 vertical line (또는 outputCol - 1)
- 이 범위 내에서만 배치 가능
```

### 4. Branch 행 추가 규칙 (Step 사이에 Vertical Line 삽입)

- Step 0에는 배치 불가
- 가장 왼쪽 v-up보다 왼쪽에는 배치 불가
- Branch 행은 기본 Line_Normal 배경 없음 (빈 셀이 비어 보임)

### 5. Horizontal Line (Line) 처리

- 메인 행: CSS 배경으로 기본 표시, 별도 배치 불필요
- Branch 행: 명시적으로 Line 컴포넌트 배치 가능
- **Line은 빈 셀로 취급**: 다른 컴포넌트가 Line 위에 배치 가능 (덮어쓰기)
- **Line으로 덮어쓰기 = 삭제**: 컴포넌트 위에 Line 배치 시 delete와 동일 (왼쪽 shift)

## Insert 규칙

### 빈 셀에서 클릭

자동 배치와 동일 (`findAutoPlaceTd` 사용)

### 컴포넌트가 있는 셀에서 클릭

오른쪽 shift 발생:

1. 클릭한 셀부터 오른쪽으로 가장 먼 컴포넌트 탐색
2. 해당 컴포넌트부터 클릭 위치까지 오른쪽으로 1칸씩 shift
3. 가장 오른쪽 컴포넌트가 마지막 step에 있으면 insert 불가
4. Vertical line은 shift에 포함되지 않음 (위치 고정)

## Delete 규칙

1. 컴포넌트 삭제 후 같은 범위(다음 vertical line까지) 내의 오른쪽 컴포넌트를 왼쪽으로 shift
2. OutputCol(11번)의 output 삭제 시 Output_Basic으로 복원 (comment 유지)
3. 빈 rung이 되면 자동 삭제

## Paste 규칙

- Output 계열: outputCol에 배치
- Input/Contact 계열: `findAutoPlaceTd` 사용 (자동 배치 규칙 적용)
- 접점은 같은 변수명 허용
- 출력은 변수명 중복 시 변수명 비움

## 변수명 규칙

### 접두사 → 컴포넌트 자동 전환

| 접두사 | Contact A | Contact B | Output |
|--------|-----------|-----------|--------|
| X | PB_A | PB_B | - |
| M | Contact_Memory_A | Contact_Memory_B | Function_Memory |
| Y | Contact_Y_A | Contact_Y_B | Output_Y |
| T | Contact_Timer_A | Contact_Timer_B | Output_Timer |
| C | Contact_Counter_A | Contact_Counter_B | Output_Counter |

### A/B 접점 전환

변수명 끝에 `a` 또는 `b`를 붙이면 접점 타입 전환:
- `X0a` → X0 A접점 (NO)
- `X0b` → X0 B접점 (NC)

### 코일 중복 방지

같은 변수명의 출력(코일)은 1개만 허용
단, RST는 해당 규칙에 대해서 예외
