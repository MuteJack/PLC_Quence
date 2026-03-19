const Ladder = {
    rungCount: 1,
    stepCount: 10,
    selectedRow: null,

    init() {
        document.querySelector('.btn-add-rung').addEventListener('click', () => this.addRung());

        // #열 클릭으로 rung 선택
        document.querySelector('#ladder-table tbody').addEventListener('click', (e) => {
            const td = e.target.closest('td');
            if (!td) return;
            const tr = td.closest('.rung-row');
            if (!tr || tr.classList.contains('rung-add')) return;

            // 2번째 td(#열)를 클릭했는지 확인
            const cells = Array.from(tr.children);
            if (cells.indexOf(td) === 1) {
                this.selectRung(tr);
            }
        });

        // Delete 키로 선택된 rung 삭제
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' && this.selectedRow) {
                this.deleteRung();
            }
        });
    },

    selectRung(tr) {
        // 이전 선택 해제
        if (this.selectedRow) {
            this.selectedRow.classList.remove('rung-selected');
        }

        // 같은 행 다시 클릭하면 선택 해제
        if (this.selectedRow === tr) {
            this.selectedRow = null;
            return;
        }

        tr.classList.add('rung-selected');
        this.selectedRow = tr;
    },

    deleteRung() {
        const tbody = document.querySelector('#ladder-table tbody');
        const rows = tbody.querySelectorAll('.rung-row:not(.rung-add)');

        // 최소 1개 rung은 유지
        if (rows.length <= 1) return;

        this.selectedRow.remove();
        this.selectedRow = null;

        // 렁 번호 재정렬
        this.renumberRungs();
    },

    renumberRungs() {
        const tbody = document.querySelector('#ladder-table tbody');
        const rows = tbody.querySelectorAll('.rung-row:not(.rung-add)');
        rows.forEach((row, i) => {
            row.children[1].textContent = i;
        });
        this.rungCount = rows.length;
    },

    addRung() {
        const tbody = document.querySelector('#ladder-table tbody');
        const addRow = tbody.querySelector('.rung-add');

        const tr = document.createElement('tr');
        tr.className = 'rung-row';

        const stepCell = '<td><div class="step-cell"><div class="step-name"></div><div class="step-symbol"></div><div class="step-comment"></div></div></td>';
        let cells = `<td></td><td>${this.rungCount}</td>`;
        for (let i = 0; i < this.stepCount; i++) {
            cells += stepCell;
        }
        cells += '<td></td>';
        tr.innerHTML = cells;

        tbody.insertBefore(tr, addRow);
        this.rungCount++;
    }
};

document.addEventListener('DOMContentLoaded', () => Ladder.init());
