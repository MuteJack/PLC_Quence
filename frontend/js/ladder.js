const Ladder = {
    rungCount: 1,
    stepCount: 12,
    outputCol: 11, // 마지막 열 = output 전용
    selectedRow: null,
    selectedComponent: null,
    selectedStep: null,
    selectedVertical: null,

    STEP_CELL_HTML: '<td><div class="step-cell"><div class="step-name"></div><div class="step-symbol"><div class="step-symbol-back"></div><div class="step-symbol-fore"><div class="step-symbol-left"></div><div class="step-symbol-center"></div><div class="step-symbol-right"></div></div></div><div class="step-comment"></div></div></td>',

    // branch row의 빈 셀 (Line_Normal 배경 없음)
    BRANCH_CELL_HTML: '<td><div class="step-cell branch-cell"><div class="step-name"></div><div class="step-symbol"><div class="step-symbol-back"></div><div class="step-symbol-fore"><div class="step-symbol-left"></div><div class="step-symbol-center"></div><div class="step-symbol-right"></div></div></div><div class="step-comment"></div></div></td>',

    init() {
        document.querySelector('.btn-add-rung').addEventListener('click', () => this.addRung());

        // 더블클릭 → Comment 편집
        document.querySelector('#ladder-table tbody').addEventListener('dblclick', (e) => {
            // Rung Comment 열
            const td = e.target.closest('td');
            if (td) {
                const tr = td.closest('.rung-row');
                if (tr && !tr.classList.contains('rung-add')) {
                    const cells = Array.from(tr.children);
                    if (cells.indexOf(td) === 0) {
                        this.editComment(td);
                        return;
                    }
                }
            }

            // Step Comment (컴포넌트가 있는 셀만)
            const stepComment = e.target.closest('.step-comment');
            if (stepComment) {
                const symbol = stepComment.closest('.step-cell').querySelector('.step-symbol');
                if (symbol && symbol.dataset.component && symbol.dataset.component !== 'Line') {
                    this.editComment(stepComment);
                }
            }
        });

        document.querySelectorAll('.comp-item').forEach(item => {
            item.addEventListener('click', () => this.selectComponent(item));
        });

        // 인접 셀 하이라이트
        document.querySelector('#ladder-table tbody').addEventListener('mouseover', (e) => {
            if (!this.selectedComponent) return;
            this.clearAdjacentHighlight();

            const right = e.target.closest('.step-symbol-right');
            if (right) {
                const td = right.closest('td');
                const nextTd = td.nextElementSibling;
                if (nextTd) {
                    const adjLeft = nextTd.querySelector('.step-symbol-left');
                    if (adjLeft) adjLeft.classList.add('adjacent-highlight');
                }
                return;
            }

            const left = e.target.closest('.step-symbol-left');
            if (left) {
                const td = left.closest('td');
                const prevTd = td.previousElementSibling;
                if (prevTd) {
                    const adjRight = prevTd.querySelector('.step-symbol-right');
                    if (adjRight) adjRight.classList.add('adjacent-highlight');
                }
            }
        });

        document.querySelector('#ladder-table tbody').addEventListener('mouseout', (e) => {
            const zone = e.target.closest('.step-symbol-left, .step-symbol-right');
            if (zone) this.clearAdjacentHighlight();
        });

        // 클릭 이벤트
        document.querySelector('#ladder-table tbody').addEventListener('click', (e) => {
            if (this.selectedComponent) {
                const type = this.selectedComponent.dataset.type;

                // Vertical: 좌/우 영역만 클릭 가능
                if (type === 'Vertical') {
                    const symbolLeft = e.target.closest('.step-symbol-left');
                    const symbolRight = e.target.closest('.step-symbol-right');
                    if (symbolLeft || symbolRight) {
                        this.placeVertical(symbolLeft || symbolRight);
                    }
                    return;
                }

                // 가운데 클릭 → 배치
                const symbolCenter = e.target.closest('.step-symbol-center');
                if (symbolCenter) {
                    this.placeComponent(symbolCenter);
                    return;
                }

                // 왼쪽/오른쪽 클릭
                const symbolLeft = e.target.closest('.step-symbol-left');
                const symbolRight = e.target.closest('.step-symbol-right');
                if (symbolLeft || symbolRight) {
                    const zone = symbolLeft || symbolRight;
                    const td = zone.closest('td');
                    const symbol = td.querySelector('.step-symbol');
                    const hasComponent = symbol && symbol.dataset.component && symbol.dataset.component !== 'Line';

                    if (hasComponent) {
                        // 컴포넌트가 있는 셀 → shift insert
                        const direction = symbolLeft ? 'left' : 'right';
                        this.insertComponent(zone, direction);
                    } else {
                        // 빈 셀 → center처럼 자동 배치
                        const center = zone.closest('.step-symbol').querySelector('.step-symbol-center');
                        if (center) this.placeComponent(center);
                    }
                    return;
                }
            }

            // 컴포넌트 미선택: center 클릭 → step 선택
            const symbolCenter = e.target.closest('.step-symbol-center');
            if (symbolCenter) {
                const symbolDiv = symbolCenter.closest('.step-symbol');
                if (symbolDiv.dataset.component && symbolDiv.dataset.component !== 'Output_Basic') {
                    this.selectStep(symbolDiv);
                    return;
                }
            }

            // 컴포넌트 미선택: 좌/우 영역 클릭 → vertical line 선택
            const sideZone = e.target.closest('.step-symbol-left, .step-symbol-right');
            if (sideZone) {
                const stepCell = sideZone.closest('.step-cell');
                const side = sideZone.classList.contains('step-symbol-right') ? 'right' : 'left';
                const vLine = stepCell.querySelector(`.vertical-line.vertical-line-${side}`);
                if (vLine) {
                    this.selectVerticalLine(vLine);
                    return;
                }
            }

            // #열 또는 Comment열 클릭 → rung/branch 선택
            const td = e.target.closest('td');
            if (!td) return;
            const tr = td.closest('.rung-row');
            if (!tr || tr.classList.contains('rung-add')) return;

            const cells = Array.from(tr.children);
            if (cells.indexOf(td) === 1) {
                this.selectRung(tr);
            }
        });

        // 초기 rung에 기본 output 설정
        const initialRows = document.querySelectorAll('#ladder-table tbody .rung-row:not(.rung-add):not(.rung-branch)');
        initialRows.forEach(row => this.setDefaultOutput(row));

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Delete') {
                if (this.selectedVertical) {
                    this.deleteVerticalLine();
                } else if (this.selectedStep) {
                    this.deleteStep();
                } else if (this.selectedRow) {
                    this.deleteRung();
                }
            }
            if (e.key === 'Escape') {
                this.clearComponentSelection();
                this.clearStepSelection();
                this.clearVerticalSelection();
            }
        });
    },

    // === Component 선택 ===

    selectComponent(item) {
        if (this.selectedComponent) {
            this.selectedComponent.classList.remove('comp-selected');
        }
        if (this.selectedComponent === item) {
            this.selectedComponent = null;
            document.body.classList.remove('placing-mode');
            return;
        }
        item.classList.add('comp-selected');
        this.selectedComponent = item;
        document.body.classList.add('placing-mode');
    },

    clearAdjacentHighlight() {
        document.querySelectorAll('.adjacent-highlight').forEach(el => {
            el.classList.remove('adjacent-highlight');
        });
    },

    clearComponentSelection() {
        if (this.selectedComponent) {
            this.selectedComponent.classList.remove('comp-selected');
            this.selectedComponent = null;
            document.body.classList.remove('placing-mode');
        }
    },

    // === Step 선택/삭제 ===

    selectStep(symbolDiv) {
        if (this.selectedStep) {
            this.selectedStep.classList.remove('step-selected');
        }
        if (this.selectedStep === symbolDiv) {
            this.selectedStep = null;
            return;
        }
        if (this.selectedRow) {
            this.selectedRow.classList.remove('rung-selected');
            this.selectedRow = null;
        }
        symbolDiv.classList.add('step-selected');
        this.selectedStep = symbolDiv;
    },

    clearStepSelection() {
        if (this.selectedStep) {
            this.selectedStep.classList.remove('step-selected');
            this.selectedStep = null;
        }
    },

    selectVerticalLine(vLine) {
        if (this.selectedVertical) {
            this.selectedVertical.classList.remove('vertical-selected');
        }
        if (this.selectedVertical === vLine) {
            this.selectedVertical = null;
            return;
        }
        // 他の選択解除
        this.clearStepSelection();
        if (this.selectedRow) {
            this.selectedRow.classList.remove('rung-selected');
            this.selectedRow = null;
        }
        vLine.classList.add('vertical-selected');
        this.selectedVertical = vLine;
    },

    clearVerticalSelection() {
        if (this.selectedVertical) {
            this.selectedVertical.classList.remove('vertical-selected');
            this.selectedVertical = null;
        }
    },

    deleteVerticalLine() {
        const vLine = this.selectedVertical;
        const stepCell = vLine.closest('.step-cell');
        const td = stepCell.closest('td');
        const tr = td.closest('tr');

        // この vertical line の方向とside
        const isDown = vLine.classList.contains('v-down');
        const isRight = vLine.classList.contains('vertical-line-right');
        const side = isRight ? 'right' : 'left';

        // 対になる行を見つける
        let pairedRow;
        if (isDown) {
            // メイン行 → branch行のv-upを探す
            pairedRow = tr.nextElementSibling;
        } else {
            // branch行 → メイン行のv-downを探す
            pairedRow = tr.previousElementSibling;
        }

        // 同じ列位置のペアを削除
        if (pairedRow) {
            const cells = Array.from(tr.children);
            const tdIdx = cells.indexOf(td);
            const pairedTd = pairedRow.children[tdIdx];
            if (pairedTd) {
                const pairedCell = pairedTd.querySelector('.step-cell');
                if (pairedCell) {
                    const pairedDir = isDown ? 'v-up' : 'v-down';
                    const pairedLine = pairedCell.querySelector(`.vertical-line.vertical-line-${side}.${pairedDir}`);
                    if (pairedLine) pairedLine.remove();
                }
            }
        }

        // 自分を削除
        vLine.remove();
        this.selectedVertical = null;

        // branch row를 특정하여 비어있으면 삭제
        const branchRow = isDown ? pairedRow : tr;
        if (branchRow && branchRow.classList.contains('rung-branch')) {
            const remainingLines = branchRow.querySelectorAll('.vertical-line');
            const remainingComponents = branchRow.querySelectorAll('.step-symbol[data-component]');
            if (remainingLines.length === 0 && remainingComponents.length === 0) {
                branchRow.remove();
            }
        }
    },

    deleteStep() {
        const symbolDiv = this.selectedStep;
        const td = symbolDiv.closest('td');
        const tr = td.closest('tr');
        const isBranch = tr.classList.contains('rung-branch');
        const cells = Array.from(tr.children);
        const stepTds = cells.slice(2, 2 + this.stepCount);
        const deletedIdx = stepTds.indexOf(td);

        // outputCol의 output 삭제 → Output_Basic으로 복원 (comment 유지)
        if (!isBranch && deletedIdx === this.outputCol) {
            const back = symbolDiv.querySelector('.step-symbol-back');
            back.innerHTML = '<img src="images/Components/Output_Basic_Normal.svg">';
            symbolDiv.dataset.component = 'Output_Basic';
            this.selectedStep = null;
            symbolDiv.classList.remove('step-selected');
            return;
        }

        // 삭제 전에 vertical line 위치 저장
        const vLineData = this.getVerticalLineIndices(tr);

        // 삭제 위치에서 오른쪽 경계(vertical line) 찾기
        const vlineSelector = isBranch ? '.vertical-line.v-up' : '.vertical-line';

        // 삭제 위치에서 같은 구간의 끝 찾기
        // vertical line은 셀 오른쪽에 붙음 → 그 셀까지가 구간 끝
        let rangeEnd = deletedIdx;
        for (let i = deletedIdx; i < this.outputCol; i++) {
            rangeEnd = i;
            const cell = stepTds[i].querySelector('.step-cell');
            if (cell && cell.querySelector(vlineSelector)) break;
        }

        // shift 대상 수집 (deletedIdx ~ rangeEnd)
        const shiftable = [];
        for (let i = deletedIdx; i <= rangeEnd; i++) {
            shiftable.push(i);
        }

        // shiftable 내에서 왼쪽으로 shift
        for (let j = 0; j < shiftable.length - 1; j++) {
            this.copyCellContent(stepTds[shiftable[j + 1]], stepTds[shiftable[j]]);
        }

        // 마지막 shiftable 셀 비우기
        if (shiftable.length > 0) {
            const lastIdx = shiftable[shiftable.length - 1];
            const lastSymbol = stepTds[lastIdx].querySelector('.step-symbol');
            const lastBack = stepTds[lastIdx].querySelector('.step-symbol-back');
            const lastComment = stepTds[lastIdx].querySelector('.step-comment');
            lastBack.innerHTML = '';
            delete lastSymbol.dataset.component;
            if (lastComment) lastComment.textContent = '';
        }

        // vertical line 재배치
        this.restoreVerticalLines(tr, vLineData);

        this.selectedStep = null;
        symbolDiv.classList.remove('step-selected');

        // branch row에서 삭제 시, 비어있으면 행 삭제
        if (tr && tr.classList.contains('rung-branch')) {
            const remainingLines = tr.querySelectorAll('.vertical-line');
            const remainingComponents = tr.querySelectorAll('.step-symbol[data-component]');
            if (remainingLines.length === 0 && remainingComponents.length === 0) {
                tr.remove();
            }
        }

        // 메인 행에서 삭제 시, 완전히 비면 행 삭제 (최소 1개 유지)
        if (tr && !tr.classList.contains('rung-branch') && this.isRungEmpty(tr)) {
            const tbody = document.querySelector('#ladder-table tbody');
            const mainRows = tbody.querySelectorAll('.rung-row:not(.rung-add):not(.rung-branch)');
            if (mainRows.length > 1) {
                // branch row도 함께 삭제
                let next = tr.nextElementSibling;
                while (next && next.classList.contains('rung-branch')) {
                    const toRemove = next;
                    next = next.nextElementSibling;
                    toRemove.remove();
                }
                tr.remove();
                this.renumberRungs();
            }
        }
    },

    // === 타입 판별 ===

    // Line 컴포넌트는 빈 셀로 취급
    isCellAvailable(td) {
        const symbol = td.querySelector('.step-symbol');
        if (!symbol) return false;
        if (!symbol.dataset.component) return true;
        if (symbol.dataset.component === 'Line') return true;
        return false;
    },

    isOutputType(type) {
        return type.startsWith('Output_') || type.startsWith('Function_');
    },

    isInputType(type) {
        return type.startsWith('PB_') || type.startsWith('Contact_');
    },

    // === 컴포넌트 배치 ===

    placeComponent(symbolCenter) {
        const type = this.selectedComponent.dataset.type;
        const imgSrc = `images/Components/${type}_Normal.svg`;
        const symbolDiv = symbolCenter.closest('.step-symbol');
        const td = symbolDiv.closest('td');
        const tr = td.closest('tr');

        // Line을 컴포넌트가 있는 셀에 배치 → delete와 동일 동작
        if (type === 'Line' && symbolDiv.dataset.component && symbolDiv.dataset.component !== 'Line') {
            this.selectedStep = symbolDiv;
            symbolDiv.classList.add('step-selected');
            this.deleteStep();
            return;
        }

        // 메인 행에서 빈 셀에 Line 배치는 무시 (기본 배경이 이미 Line)
        if (type === 'Line' && !tr.classList.contains('rung-branch')) return;

        // output → 항상 outputCol에 배치
        if (this.isOutputType(type)) {
            const cells = Array.from(tr.children);
            const outputTd = cells[2 + this.outputCol];
            if (!outputTd) return;
            const outSymbol = outputTd.querySelector('.step-symbol');
            const outBack = outputTd.querySelector('.step-symbol-back');
            outBack.innerHTML = `<img src="${imgSrc}">`;
            outSymbol.dataset.component = type;
            return;
        }

        // 빈 셀 또는 Line 셀 클릭 → 자동 배치
        if (!symbolDiv.dataset.component || symbolDiv.dataset.component === 'Line') {
            const clickedIdx = Array.from(tr.children).indexOf(td) - 2;
            const targetTd = this.findAutoPlaceTd(tr, type, clickedIdx);
            if (!targetTd) return;
            const targetSymbol = targetTd.querySelector('.step-symbol');
            const targetBack = targetTd.querySelector('.step-symbol-back');
            targetBack.innerHTML = `<img src="${imgSrc}">`;
            targetSymbol.dataset.component = type;
            return;
        }

        // 이미 컴포넌트가 있는 셀 → 교체
        const backDiv = symbolDiv.querySelector('.step-symbol-back');
        backDiv.innerHTML = `<img src="${imgSrc}">`;
        symbolDiv.dataset.component = type;
    },

    // 자동 배치: 클릭 위치 기준으로 가장 가까운 vertical line 범위 내에서 배치
    findAutoPlaceTd(tr, type, clickedIdx) {
        const cells = Array.from(tr.children);
        const stepTds = cells.slice(2, 2 + this.stepCount);
        const isBranch = tr.classList.contains('rung-branch');

        // branch에서는 v-up만 범위 경계, 메인에서는 모든 vertical-line이 경계
        const boundarySelector = isBranch ? '.vertical-line.v-up' : '.vertical-line';

        // 클릭 위치 왼쪽에서 가장 가까운 경계 찾기 (클릭 셀 자체는 제외)
        let rangeStart = 0;
        for (let i = clickedIdx - 1; i >= 0; i--) {
            const cell = stepTds[i].querySelector('.step-cell');
            if (cell && cell.querySelector(boundarySelector)) {
                rangeStart = i + 1;
                break;
            }
        }

        // branch: 가장 왼쪽 v-up보다 왼쪽은 배치 불가
        if (isBranch) {
            let firstVLineIdx = -1;
            for (let i = 0; i < stepTds.length; i++) {
                const cell = stepTds[i].querySelector('.step-cell');
                if (cell && cell.querySelector('.vertical-line.v-up')) {
                    firstVLineIdx = i;
                    break;
                }
            }
            if (firstVLineIdx >= 0 && rangeStart <= firstVLineIdx) {
                rangeStart = firstVLineIdx + 1;
            }
            if (clickedIdx <= firstVLineIdx) return null;
        }

        // 클릭 위치 오른쪽에서 가장 가까운 경계 찾기 (outputCol 제외, 클릭 셀 자체는 제외)
        let rangeEnd = this.outputCol - 1;
        for (let i = clickedIdx + 1; i < this.outputCol; i++) {
            const cell = stepTds[i].querySelector('.step-cell');
            if (cell && cell.querySelector(boundarySelector)) {
                rangeEnd = i;
                break;
            }
        }

        // Line 배치 시에는 진짜 빈 셀만, 그 외에는 Line도 빈 셀 취급
        const checkAvailable = (td) => {
            if (type === 'Line') {
                const symbol = td.querySelector('.step-symbol');
                return symbol && !symbol.dataset.component;
            }
            return this.isCellAvailable(td);
        };

        if (this.isOutputType(type)) {
            for (let i = rangeEnd; i >= rangeStart; i--) {
                if (isBranch && i === 0) continue;
                if (checkAvailable(stepTds[i])) {
                    return stepTds[i];
                }
            }
        } else {
            for (let i = rangeStart; i <= rangeEnd; i++) {
                if (isBranch && i === 0) continue;
                if (checkAvailable(stepTds[i])) {
                    return stepTds[i];
                }
            }
        }
        return null;
    },

    isRungFull(tr) {
        const cells = Array.from(tr.children);
        const stepTds = cells.slice(2, 2 + this.stepCount);
        return stepTds.every(td => td.querySelector('.step-symbol[data-component]'));
    },

    // === Insert ===

    createNewStepTd(type, isBranch) {
        const imgSrc = `images/Components/${type}_Normal.svg`;
        const template = document.createElement('template');
        template.innerHTML = isBranch ? this.BRANCH_CELL_HTML : this.STEP_CELL_HTML;
        const td = template.content.firstElementChild;
        td.querySelector('.step-symbol-back').innerHTML = `<img src="${imgSrc}">`;
        td.querySelector('.step-symbol').dataset.component = type;
        return td;
    },

    // vertical line 위치(열 인덱스) 수집
    getVerticalLineIndices(tr) {
        const cells = Array.from(tr.children).slice(2, 2 + this.stepCount);
        const indices = [];
        cells.forEach((td, i) => {
            const cell = td.querySelector('.step-cell');
            if (cell) {
                const lines = cell.querySelectorAll('.vertical-line');
                lines.forEach(line => {
                    indices.push({
                        colIdx: i,
                        classes: Array.from(line.classList)
                    });
                });
            }
        });
        return indices;
    },

    // vertical line 재배치
    restoreVerticalLines(tr, lineData) {
        // 기존 vertical line 전부 제거
        tr.querySelectorAll('.vertical-line').forEach(el => el.remove());
        // 저장된 위치에 재배치
        const cells = Array.from(tr.children).slice(2, 2 + this.stepCount);
        lineData.forEach(data => {
            const td = cells[data.colIdx];
            if (!td) return;
            const cell = td.querySelector('.step-cell');
            if (!cell) return;
            const line = document.createElement('div');
            line.className = data.classes.join(' ');
            cell.appendChild(line);
        });
    },

    // insert: 현재 셀 ~ 가장 가까운 오른쪽 빈 셀 사이를 밀기
    insertComponent(clickedZone, direction) {
        const currentTd = clickedZone.closest('td');
        const tr = currentTd.closest('tr');
        const isBranch = tr.classList.contains('rung-branch');
        const type = this.selectedComponent.dataset.type;

        // 메인 행에서 Line insert는 무시
        if (type === 'Line' && !isBranch) return;

        // branch: 가장 왼쪽 v-up보다 왼쪽이면 insert 불가
        if (isBranch) {
            const cells = Array.from(tr.children);
            const stepTds = cells.slice(2, 2 + this.stepCount);
            const currentIdx = stepTds.indexOf(currentTd);
            let firstVLineIdx = -1;
            for (let i = 0; i < stepTds.length; i++) {
                const cell = stepTds[i].querySelector('.step-cell');
                if (cell && cell.querySelector('.vertical-line.v-up')) {
                    firstVLineIdx = i;
                    break;
                }
            }
            if (firstVLineIdx >= 0 && currentIdx <= firstVLineIdx) return;
        }

        const cells = Array.from(tr.children);
        const stepTds = cells.slice(2, 2 + this.stepCount);
        const currentIdx = stepTds.indexOf(currentTd);
        const insertIdx = direction === 'left' ? currentIdx : currentIdx + 1;

        // output은 insert 불가
        if (this.isOutputType(type)) return;

        // insertIdx부터 같은 구간 내에서 빈 셀 찾기
        const isBranchRow = tr.classList.contains('rung-branch');
        const vlineSel = isBranchRow ? '.vertical-line.v-up' : '.vertical-line';
        let emptyIdx = -1;
        for (let i = insertIdx; i < this.outputCol; i++) {
            // vertical line이 있는 셀 = 구간 끝, 빈 셀이면 여기까지 포함
            const cell = stepTds[i].querySelector('.step-cell');
            const hasVLine = cell && cell.querySelector(vlineSel);
            if (this.isCellAvailable(stepTds[i])) {
                emptyIdx = i;
                break;
            }
            if (hasVLine) break;
        }

        if (emptyIdx === -1) return;

        // vertical line 위치 저장
        const vLineData = this.getVerticalLineIndices(tr);

        // 빈 셀 ← 방향으로 내용 shift (emptyIdx부터 insertIdx까지)
        for (let i = emptyIdx; i > insertIdx; i--) {
            this.copyCellContent(stepTds[i - 1], stepTds[i]);
        }

        // insertIdx 셀을 새 컴포넌트로 채우기
        this.setCellContent(stepTds[insertIdx], type);

        // vertical line 원래 위치에 재배치
        this.restoreVerticalLines(tr, vLineData);
    },

    // 셀 내용 복사 (src → dst)
    copyCellContent(srcTd, dstTd) {
        const srcSymbol = srcTd.querySelector('.step-symbol');
        const dstSymbol = dstTd.querySelector('.step-symbol');
        const srcBack = srcTd.querySelector('.step-symbol-back');
        const dstBack = dstTd.querySelector('.step-symbol-back');
        const srcComment = srcTd.querySelector('.step-comment');
        const dstComment = dstTd.querySelector('.step-comment');

        dstBack.innerHTML = srcBack.innerHTML;
        if (srcSymbol.dataset.component) {
            dstSymbol.dataset.component = srcSymbol.dataset.component;
        } else {
            delete dstSymbol.dataset.component;
        }

        if (srcComment && dstComment) {
            dstComment.textContent = srcComment.textContent;
        }
    },

    // 셀에 새 컴포넌트 설정
    setCellContent(td, type) {
        const imgSrc = `images/Components/${type}_Normal.svg`;
        const symbol = td.querySelector('.step-symbol');
        const back = td.querySelector('.step-symbol-back');
        back.innerHTML = `<img src="${imgSrc}">`;
        symbol.dataset.component = type;
    },

    insertBranchComponent(clickedZone, direction) {
        this.insertComponent(clickedZone, direction);
    },


    // === Vertical (Branch) ===

    placeVertical(clickedZone) {
        const isLeft = clickedZone.classList.contains('step-symbol-left');
        const td = clickedZone.closest('td');
        const tr = td.closest('tr');
        const cells = Array.from(tr.children);
        const stepIdx = cells.indexOf(td) - 2;

        if (stepIdx < 0 || stepIdx >= this.stepCount) return;

        // 세로선은 한쪽 셀에만 배치 (이중선 방지)
        // 왼쪽 클릭 → 왼쪽 셀의 오른쪽 끝에 배치
        // 오른쪽 클릭 → 현재 셀의 오른쪽 끝에 배치
        let anchorTd;
        if (isLeft) {
            anchorTd = cells[stepIdx + 2 - 1]; // 왼쪽 셀
            if (!anchorTd || !anchorTd.querySelector('.step-cell')) return;
        } else {
            anchorTd = td; // 현재 셀
        }

        // 메인 행: 아래로 반줄
        const mainCell = anchorTd.querySelector('.step-cell');
        this.addVerticalLine(mainCell, 'right', 'v-down');

        // branch row 생성 또는 기존 사용
        let branchRow = tr.nextElementSibling;
        if (!branchRow || !branchRow.classList.contains('rung-branch')) {
            branchRow = this.createBranchRow(tr);
        }

        // branch 행: 위로 반줄 (같은 열 위치)
        const branchCells = Array.from(branchRow.children);
        const branchAnchorIdx = cells.indexOf(anchorTd);
        const branchTd = branchCells[branchAnchorIdx];
        if (branchTd) {
            const branchCell = branchTd.querySelector('.step-cell');
            if (branchCell) {
                this.addVerticalLine(branchCell, 'right', 'v-up');
            }
        }
    },

    addVerticalLine(stepCell, side, direction) {
        // 같은 위치에 이미 세로선이 있으면 추가하지 않음
        const existing = stepCell.querySelector(`.vertical-line.vertical-line-${side}.${direction}`);
        if (existing) return;

        const line = document.createElement('div');
        line.className = `vertical-line vertical-line-${side} ${direction}`;
        stepCell.appendChild(line);
    },

    createBranchRow(parentRow) {
        const tr = document.createElement('tr');
        tr.className = 'rung-row rung-branch';
        tr.dataset.rung = parentRow.dataset.rung || parentRow.children[1].textContent;

        // Comment, #: 빈 셀 (렁 번호 없음)
        let cells = '<td></td><td></td>';
        for (let i = 0; i < this.stepCount; i++) {
            cells += this.BRANCH_CELL_HTML;
        }
        cells += '<td></td>';
        tr.innerHTML = cells;

        // parentRow 바로 아래에 삽입
        parentRow.parentNode.insertBefore(tr, parentRow.nextSibling);
        return tr;
    },

    // === Comment 편집 ===

    editComment(td) {
        if (td.querySelector('input')) return;

        const currentText = td.textContent.trim();
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentText;
        input.className = 'comment-input';

        td.textContent = '';
        td.appendChild(input);
        input.focus();

        const finish = () => {
            const value = input.value.trim();
            td.textContent = value;
        };

        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') {
                input.value = currentText;
                input.blur();
            }
        });
    },

    // === Rung 선택/삭제/추가 ===

    selectRung(tr) {
        if (this.selectedRow) {
            this.selectedRow.classList.remove('rung-selected');
        }
        if (this.selectedRow === tr) {
            this.selectedRow = null;
            return;
        }
        tr.classList.add('rung-selected');
        this.selectedRow = tr;
    },

    deleteRung() {
        const tbody = document.querySelector('#ladder-table tbody');
        const tr = this.selectedRow;

        // branch 행 삭제
        if (tr.classList.contains('rung-branch')) {
            // 메인 행의 대응하는 vertical line(v-down)도 제거
            const prevRow = tr.previousElementSibling;
            if (prevRow && !prevRow.classList.contains('rung-branch')) {
                // branch의 v-up 위치 확인 후 메인의 같은 열에서 v-down 제거
                const branchCells = Array.from(tr.children).slice(2, 2 + this.stepCount);
                const mainCells = Array.from(prevRow.children).slice(2, 2 + this.stepCount);
                branchCells.forEach((btd, i) => {
                    const bCell = btd.querySelector('.step-cell');
                    if (bCell && bCell.querySelector('.vertical-line.v-up')) {
                        const mCell = mainCells[i] ? mainCells[i].querySelector('.step-cell') : null;
                        if (mCell) {
                            const vDown = mCell.querySelector('.vertical-line.v-down');
                            if (vDown) vDown.remove();
                        }
                    }
                });
            }
            tr.remove();
            this.selectedRow = null;
            return;
        }

        // 메인 행 삭제
        const rows = tbody.querySelectorAll('.rung-row:not(.rung-add):not(.rung-branch)');
        if (rows.length <= 1) return;

        // branch row도 함께 삭제
        let next = tr.nextElementSibling;
        tr.remove();
        while (next && next.classList.contains('rung-branch')) {
            const toRemove = next;
            next = next.nextElementSibling;
            toRemove.remove();
        }

        this.selectedRow = null;
        this.renumberRungs();
    },

    renumberRungs() {
        const tbody = document.querySelector('#ladder-table tbody');
        const rows = tbody.querySelectorAll('.rung-row:not(.rung-add):not(.rung-branch)');
        rows.forEach((row, i) => {
            row.children[1].textContent = i;
        });
        this.rungCount = rows.length;
    },

    isRungEmpty(tr) {
        const cells = Array.from(tr.children).slice(2, 2 + this.stepCount);
        return cells.every(td => {
            const symbol = td.querySelector('.step-symbol');
            const hasVertical = td.querySelector('.vertical-line');
            if (hasVertical) return false;
            if (!symbol || !symbol.dataset.component) return true;
            if (symbol.dataset.component === 'Output_Basic') return true;
            return false;
        });
    },

    addRung() {
        const tbody = document.querySelector('#ladder-table tbody');
        const addRow = tbody.querySelector('.rung-add');

        // 맨 아래 rung이 비어있으면 추가 안 함
        const mainRows = tbody.querySelectorAll('.rung-row:not(.rung-add):not(.rung-branch)');
        const lastRow = mainRows[mainRows.length - 1];
        if (lastRow && this.isRungEmpty(lastRow)) return;

        const tr = document.createElement('tr');
        tr.className = 'rung-row';

        let cells = `<td></td><td>${this.rungCount}</td>`;
        for (let i = 0; i < this.stepCount; i++) {
            cells += this.STEP_CELL_HTML;
        }
        cells += '<td></td>';
        tr.innerHTML = cells;

        tbody.insertBefore(tr, addRow);
        this.setDefaultOutput(tr);
        this.rungCount++;
    },

    // 메인 행의 outputCol에 Output_Basic 기본값 설정
    setDefaultOutput(tr) {
        const cells = Array.from(tr.children);
        const outputTd = cells[2 + this.outputCol];
        if (!outputTd) return;
        const symbol = outputTd.querySelector('.step-symbol');
        const back = outputTd.querySelector('.step-symbol-back');
        if (symbol && back && !symbol.dataset.component) {
            back.innerHTML = '<img src="images/Components/Output_Basic_Normal.svg">';
            symbol.dataset.component = 'Output_Basic';
        }
    }
};

document.addEventListener('DOMContentLoaded', () => Ladder.init());
