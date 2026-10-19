(() => {
    'use strict';

    /* =====================================================
       1. CẤU HÌNH LƯƠNG (muốn đổi mức lương chỉ sửa ở đây)
       ===================================================== */
    const MONTHLY_SALARY = 6000000; // lương tháng chuẩn (đ)
    const HOURS_PER_DAY  = 8;       // quy ước số giờ/ngày
    const OVERTIME_RATE  = 1.5;     // tăng ca = 150% lương giờ
    const SUNDAY_RATE    = 2;       // làm Chủ nhật = 200% lương giờ

    const STORAGE_KEY = 'personal-attendance-v1'; // dữ liệu cũ (1 người)
    const PEOPLE_KEY  = 'attendance-people-v1';
    const ACTIVE_KEY  = 'attendance-active-person-v1';

    /* =====================================================
       2. HÀM TIỆN ÍCH
       ===================================================== */
    const $ = id => document.getElementById(id);
    const pad = n => String(n).padStart(2, '0');
    const localISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const byDateAsc = (a, b) => a.date.localeCompare(b.date);
    const byDateDesc = (a, b) => b.date.localeCompare(a.date);

    /** Số → chuỗi dùng dấu phẩy thập phân (0.5 → "0,5") */
    const fmtNumber = n => String(n).replace('.', ',');

    /** Số → tiền Việt ("6000000" → "6.000.000 đ") */
    const money = n => Math.round(n).toLocaleString('vi-VN') + ' đ';

    /** Tạo phần tử HTML nhanh: el('div', 'tên-class', 'nội dung') */
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    /** Đọc / ghi localStorage an toàn (không văng lỗi nếu bị chặn) */
    function storageGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function readJSON(key) {
        try { return JSON.parse(storageGet(key) || 'null'); } catch (e) { return null; }
    }

    let toastTimer;
    function toast(message) {
        const box = $('toast');
        box.textContent = message;
        box.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => box.classList.remove('show'), 2400);
    }

    /* =====================================================
       3. NGÀY THÁNG
       ===================================================== */
    const toDate = iso => new Date(iso + 'T12:00:00');
    const isSunday = iso => toDate(iso).getDay() === 0;

    function fmtDate(iso) {
        const d = toDate(iso);
        return {
            day: d.getDate(),
            dow: d.toLocaleDateString('vi-VN', { weekday: 'short' }),
            full: d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
        };
    }

    /** Số ngày làm việc tiêu chuẩn của tháng "YYYY-MM" (Thứ Hai – Thứ Bảy) */
    function standardDays(month) {
        if (!month) return 0;
        const [y, m] = month.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        let count = 0;
        for (let d = 1; d <= lastDay; d++) {
            if (new Date(y, m - 1, d).getDay() !== 0) count++;
        }
        return count;
    }

    /* =====================================================
       4. DỮ LIỆU: NHÂN SỰ & BẢN GHI CHẤM CÔNG
       ===================================================== */
    let people = [];
    let activeId = '';
    let records = []; // bản ghi của người đang chọn

    /** Chuẩn hóa danh sách bản ghi (đồng thời hỗ trợ dữ liệu phiên bản cũ) */
    function cleanRecords(list) {
        if (!Array.isArray(list)) return [];
        return list
            .map(r => ({
                date: r.date,
                value: Number(r.value) || 0,
                note: r.note || '',
                overtimeHours: Number(r.overtimeHours) || 0,
                overtimePay: Number(r.overtimePay) || 0,
                sundayPay: Number(r.sundayPay) || 0,
                sundayHours: Number(r.sundayHours) || 0,
                legacySundayPay: Number(r.legacySundayPay) ||
                    (r.sundayHours === undefined ? (Number(r.sundayPay) || 0) : 0),
                kind: r.kind || 'normal'
            }))
            .filter(r => r.date);
    }

    function loadPeople() {
        const saved = readJSON(PEOPLE_KEY);
        if (Array.isArray(saved) && saved.length) {
            people = saved;
        } else {
            // Chưa có ai: tạo người mặc định, kèm dữ liệu cũ nếu có
            people = [{ id: 'me', name: 'Tôi', records: cleanRecords(readJSON(STORAGE_KEY)) }];
        }

        people = people.map(p => ({
            id: String(p.id || 'p' + Date.now() + Math.random()),
            name: String(p.name || 'Chưa đặt tên'),
            records: cleanRecords(p.records)
        }));

        activeId = storageGet(ACTIVE_KEY) || people[0].id;
        if (!people.some(p => p.id === activeId)) activeId = people[0].id;
    }

    const activePerson = () => people.find(p => p.id === activeId) || people[0];
    const loadActive = () => { records = activePerson().records; };

    function persist() {
        try {
            activePerson().records = records;
            localStorage.setItem(PEOPLE_KEY, JSON.stringify(people));
            localStorage.setItem(ACTIVE_KEY, activeId);
            return true;
        } catch (e) {
            toast('Không lưu được dữ liệu trên trình duyệt này.');
            return false;
        }
    }

    /* =====================================================
       5. TÍNH LƯƠNG
       ===================================================== */

    /** Bản ghi này có phải ngày Chủ nhật không? */
    const isSundayRecord = r => isSunday(r.date) || r.kind === 'sunday';

    /** Lương 1 giờ cơ bản của tháng "YYYY-MM" */
    function hourlyRate(month) {
        const days = standardDays(month);
        return days ? MONTHLY_SALARY / days / HOURS_PER_DAY : 0;
    }

    /** Tiền & công của MỘT bản ghi */
    function recordPay(r) {
        const month = r.date.slice(0, 7);
        const hourly = hourlyRate(month);
        const dailyRate = hourly * HOURS_PER_DAY;

        const units = isSundayRecord(r) ? 0 : (Number(r.value) || 0);
        const base = dailyRate * units;
        const ot = (Number(r.overtimeHours) || 0) * hourly * OVERTIME_RATE;
        const sun = (Number(r.legacySundayPay) || 0) +
                    (Number(r.sundayHours) || 0) * hourly * SUNDAY_RATE;

        return { units, base, ot, sun, total: base + ot + sun };
    }

    /** Tổng hợp cả tháng "YYYY-MM" */
    function calc(month) {
        const rows = records.filter(r => r.date.startsWith(month)).sort(byDateAsc);
        const workRows = rows.filter(r => !isSundayRecord(r));
        const sum = key => rows.reduce((s, r) => s + recordPay(r)[key], 0);

        return {
            days: standardDays(month),
            units: sum('units'),
            base: sum('base'),
            ot: sum('ot'),
            sun: sum('sun'),
            total: sum('total'),
            full: workRows.filter(r => Number(r.value) === 1).length,
            half: workRows.filter(r => Number(r.value) === 0.5).length
        };
    }

    const EMPTY_SUMMARY = { days: 0, units: 0, base: 0, ot: 0, sun: 0, total: 0, full: 0, half: 0 };

    /** Nhãn hiển thị số công (dùng cho lịch sử) */
    function unitsLabel(value, zeroLabel) {
        const v = Number(value);
        if (v === 1) return '1 công';
        if (v === 0.5) return '0,5 công';
        return zeroLabel;
    }

    /* =====================================================
       6. HIỂN THỊ GIAO DIỆN
       ===================================================== */
    function renderPeople() {
        const select = $('personSelect');
        select.innerHTML = '';
        for (const p of people) {
            select.append(new Option(p.name, p.id));
        }
        select.value = activeId;
        $('mainTitle').textContent = 'Chấm công · ' + activePerson().name;
    }

    function renderSummary(month) {
        const c = month ? calc(month) : EMPTY_SUMMARY;
        const unitsText = fmtNumber(Number(c.units.toFixed(1)));
        const percent = c.days ? Math.min(100, Math.round(c.units / c.days * 100)) : 0;

        $('summaryMonth').textContent = month
            ? new Date(month + '-15T12:00:00').toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })
            : 'Tất cả các tháng';

        $('totalWork').textContent = unitsText;
        $('fullDays').textContent = c.full;
        $('halfDays').textContent = c.half;

        $('progressLabel').textContent = percent + '%';
        $('progressBar').style.width = percent + '%';

        $('baseSalary').textContent = money(c.base);
        $('overtimeTotal').textContent = money(c.ot);
        $('sundayTotal').textContent = money(c.sun);
        $('salaryTotal').textContent = money(c.total);

        $('salaryNote').textContent =
            `Lương tháng chuẩn: ${MONTHLY_SALARY.toLocaleString('vi-VN')}đ. ` +
            `Tháng này có ${c.days} ngày làm việc tiêu chuẩn (thứ Hai–thứ Bảy). ` +
            `Lương cơ bản = ${MONTHLY_SALARY.toLocaleString('vi-VN')}đ ÷ ${c.days} × ${unitsText} công. ` +
            `Tăng ca tính ${OVERTIME_RATE * 100}% và giờ làm Chủ nhật tính ${SUNDAY_RATE * 100}% lương giờ cơ bản ` +
            `(${HOURS_PER_DAY} giờ/ngày). Đây là mức dự kiến trước các khoản khấu trừ.`;
    }

    /** Tạo một dòng trong lịch sử chấm công */
    function createEntry(r) {
        const d = fmtDate(r.date);
        const sunday = isSundayRecord(r);
        const pay = recordPay(r);

        // Cột ngày
        const dateBox = el('div', 'entrydate');
        dateBox.append(el('strong', '', d.day), el('small', '', d.dow));

        // Cột thông tin
        const details = [];
        if (sunday) {
            details.push(`Chủ nhật: ${fmtNumber(r.sundayHours || 0)} giờ · ${money(pay.sun)}`);
        } else {
            details.push(unitsLabel(r.value, 'Không tính công'));
        }
        if (r.overtimeHours) {
            details.push(`${r.overtimeHours} giờ tăng ca`);
            details.push('Tăng ca dự kiến ' + money(pay.ot));
        }
        if (r.note) details.push(r.note);

        const info = el('div', 'entryinfo');
        info.append(el('strong', '', d.full), el('small', '', details.join(' · ')));

        // Nhãn bên phải
        const tag = el('span', 'tag', sunday ? 'Chủ nhật' : unitsLabel(r.value, '0 công'));

        // Nút xóa
        const del = el('button', 'delete', '×');
        del.type = 'button';
        del.title = 'Xóa bản ghi';
        del.setAttribute('aria-label', 'Xóa bản ghi ' + d.full);
        del.addEventListener('click', () => {
            if (!confirm('Xóa bản ghi ngày ' + d.full + '?')) return;
            records = records.filter(x => x.date !== r.date);
            persist();
            render();
            toast('Đã xóa bản ghi.');
        });

        const entry = el('article', 'entry');
        entry.append(dateBox, info, tag, del);
        return entry;
    }

    function renderHistory(month) {
        const host = $('history');
        host.innerHTML = '';

        const rows = records.filter(r => !month || r.date.startsWith(month)).sort(byDateDesc);
        if (!rows.length) {
            host.innerHTML = '<div class="empty">Chưa có dữ liệu trong tháng này.<br>Hãy lưu ngày công đầu tiên ở phía trên.</div>';
            return;
        }
        for (const r of rows) host.append(createEntry(r));
    }

    function render() {
        const month = $('monthFilter').value;
        renderSummary(month);
        renderHistory(month);
    }

    /** Bật/tắt giao diện theo ngày đang chọn (Chủ nhật hay ngày thường) */
    function updateDayType() {
        const date = $('workDate').value;
        const sunday = !!date && isSunday(date);

        $('sundayNotice').classList.toggle('hidden', !sunday);
        $('full').disabled = sunday;
        $('half').disabled = sunday;

        if (sunday) {
            $('sundayHours').placeholder = 'Ví dụ: 8';
            $('full').checked = false;
            $('half').checked = false;
        } else {
            $('sundayHours').placeholder = 'Chỉ nhập nếu có làm Chủ nhật';
            if (!$('full').checked && !$('half').checked) $('full').checked = true;
        }
    }

    /* =====================================================
       7. XUẤT FILE EXCEL (.xlsx) THEO MẪU BẢNG CHẤM CÔNG
          - Mỗi tháng là một sheet, tên "Tháng 12", "Tháng 11"...
          - Mỗi người là một dòng, mỗi ngày là một cột (D → AH)
          - Mở được bằng Excel; với Google Sheets: tải lên Drive hoặc Tệp → Nhập
       ===================================================== */
    const EXCEL_FONT = 'Times New Roman';
    const DAY_COLUMNS = 31;                  // luôn có đủ 31 cột ngày như mẫu
    const FIRST_DAY_COL = 4;                 // cột D
    const LAST_DAY_COL = FIRST_DAY_COL + DAY_COLUMNS - 1; // cột AH
    const KPI_COL = LAST_DAY_COL + 1;        // cột AI: Đánh giá KPI
    const TOTAL_COL = LAST_DAY_COL + 2;      // cột AJ: Tổng cộng
    const NOTE_COL = LAST_DAY_COL + 3;       // cột AK: Nhận xét

    const SHEET_RULES = [
        'Quy định: ',
        '1/Thời gian làm việc: S: 8h-12h; C: 1h30 - 17h30',
        '2/Làm nửa ngày ghi 0,5',
        '3/ Làm cả ngày ghi 1',
        '4/ Muộn trích quỹ 10k/lần ( Nếu không xin phép trước)',
        '- Quỹ này dùng để liên hoan cuối tháng nếu tất cả đều làm việc đúng giờ ( Tích đủ 500k ) hoặc để thưởng lại cho thành viên đi đúng - đủ - đều',
        '5/ KPI',
        '- Hiệu quả trong công việc',
        '- Thái độ nghiêm túc trong công việc',
        '6/ Làm thêm giờ bắt đầu tính từ 1h trở đi, Ngày thường là bắt đầu từ 18h30'
    ].join('\n');

    const THIN_BORDER = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
    };

    /** Gộp dữ liệu của một người trong một tháng */
    function personMonthData(person, month) {
        const byDay = {};
        let overtime = 0;
        let sundayHours = 0;
        for (const r of person.records) {
            if (!r.date.startsWith(month)) continue;
            byDay[Number(r.date.slice(8, 10))] = r;
            overtime += Number(r.overtimeHours) || 0;
            sundayHours += Number(r.sundayHours) || 0;
        }
        return { byDay, overtime, sundayHours };
    }

    /** Ghi chú nhỏ gắn vào ô ngày (giờ tăng ca, giờ Chủ nhật, ghi chú) */
    function dayCellNote(r) {
        const parts = [];
        if (r.overtimeHours) parts.push('Tăng ca ' + fmtNumber(r.overtimeHours) + ' giờ');
        if (r.sundayHours) parts.push('Chủ nhật ' + fmtNumber(r.sundayHours) + ' giờ');
        if (r.note) parts.push(r.note);
        return parts.join('\n');
    }

    /** Tạo một sheet "Bảng chấm công" cho tháng "YYYY-MM" */
    function buildAttendanceSheet(workbook, sheetName, month) {
        const [year, mon] = month.split('-').map(Number);
        const ws = workbook.addWorksheet(sheetName);
        ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

        const centered = { horizontal: 'center', vertical: 'middle', wrapText: true };
        const bold = { name: EXCEL_FONT, size: 11, bold: true };
        const plain = { name: EXCEL_FONT, size: 11 };

        // Độ rộng cột & chiều cao dòng (theo mẫu)
        ws.getColumn(1).width = 7.14;
        ws.getColumn(2).width = 22;
        ws.getColumn(3).width = 10.57;
        for (let c = FIRST_DAY_COL; c <= LAST_DAY_COL; c++) ws.getColumn(c).width = 4.14;
        ws.getColumn(KPI_COL).width = 10.14;
        ws.getColumn(TOTAL_COL).width = 10.14;
        ws.getColumn(NOTE_COL).width = 28;
        ws.getRow(2).height = 20.25;
        ws.getRow(3).height = 36;
        ws.getRow(4).height = 35.25;

        // --- Tiêu đề ---
        const title = ws.getCell(1, 1);
        title.value = 'BẢNG CHẤM CÔNG';
        title.font = { name: EXCEL_FONT, size: 18, bold: true };
        title.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.mergeCells(1, 1, 1, 33); // A1:AG1

        // --- Hàng tiêu đề bảng (dòng 3-4) ---
        for (let r = 3; r <= 4; r++) {
            for (let c = 1; c <= NOTE_COL; c++) {
                const cell = ws.getCell(r, c);
                cell.font = bold;
                cell.alignment = centered;
                cell.border = THIN_BORDER;
            }
        }
        ws.getCell(3, 1).value = 'STT';
        ws.getCell(3, 2).value = 'HỌ VÀ TÊN';
        ws.getCell(3, 3).value = 'CHỨC\n VỤ';
        ws.getCell(3, FIRST_DAY_COL).value = `NGÀY TRONG THÁNG ${mon}/${year}`;
        for (let d = 1; d <= DAY_COLUMNS; d++) ws.getCell(4, FIRST_DAY_COL + d - 1).value = d;
        ws.getCell(4, KPI_COL).value = 'Đánh giá\n KPI';
        ws.getCell(4, TOTAL_COL).value = 'Tổng\nCộng';
        ws.getCell(4, NOTE_COL).value = 'Nhận xét';
        ws.mergeCells(3, 1, 4, 1);               // STT
        ws.mergeCells(3, 2, 4, 2);               // HỌ VÀ TÊN
        ws.mergeCells(3, 3, 4, 3);               // CHỨC VỤ
        ws.mergeCells(3, FIRST_DAY_COL, 3, NOTE_COL); // NGÀY TRONG THÁNG

        // --- Mỗi người một dòng ---
        const firstDayLetter = ws.getColumn(FIRST_DAY_COL).letter;
        const lastDayLetter = ws.getColumn(LAST_DAY_COL).letter;
        const kpiLetter = ws.getColumn(KPI_COL).letter;

        people.forEach((person, i) => {
            const row = 5 + i;
            const data = personMonthData(person, month);
            let totalDays = 0;

            for (let c = 1; c <= NOTE_COL; c++) {
                const cell = ws.getCell(row, c);
                cell.font = plain;
                cell.alignment = centered;
                cell.border = THIN_BORDER;
            }

            ws.getCell(row, 1).value = i + 1;
            ws.getCell(row, 2).value = person.name;
            ws.getCell(row, 2).alignment = { horizontal: 'left', vertical: 'middle' };

            for (let d = 1; d <= DAY_COLUMNS; d++) {
                const r = data.byDay[d];
                if (!r) continue;
                const cell = ws.getCell(row, FIRST_DAY_COL + d - 1);
                if (!isSundayRecord(r)) {          // Chủ nhật không tính công thường
                    const units = Number(r.value) || 0;
                    cell.value = units;
                    totalDays += units;
                }
                const note = dayCellNote(r);
                if (note) cell.note = note;
            }

            // Tổng cộng = tổng công × KPI (nếu chưa nhập KPI thì nhân 1)
            ws.getCell(row, TOTAL_COL).value = {
                formula: `SUM(${firstDayLetter}${row}:${lastDayLetter}${row})*IF(${kpiLetter}${row}="",1,${kpiLetter}${row})`,
                result: totalDays
            };
            ws.getCell(row, TOTAL_COL).numFmt = '0.000';

            // Nhận xét: tóm tắt giờ tăng ca / Chủ nhật của tháng (có thể sửa tay)
            const summary = [];
            if (data.overtime) summary.push('Tăng ca: ' + fmtNumber(data.overtime) + ' giờ');
            if (data.sundayHours) summary.push('Chủ nhật: ' + fmtNumber(data.sundayHours) + ' giờ');
            if (summary.length) ws.getCell(row, NOTE_COL).value = summary.join('\n');
        });

        // --- Khung quy định bên dưới bảng ---
        const rulesRow = 5 + people.length + 1;
        const rules = ws.getCell(rulesRow, 2);
        rules.value = SHEET_RULES;
        rules.font = plain;
        rules.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        ws.mergeCells(rulesRow, 2, rulesRow + 5, 22); // B:V, 6 dòng
        ws.getRow(rulesRow + 5).height = 60;
    }

    async function exportExcel(all) {
        if (typeof ExcelJS === 'undefined') {
            toast('Chưa tải được thư viện xuất Excel. Hãy kiểm tra mạng rồi tải lại trang.');
            return;
        }

        activePerson().records = records; // đảm bảo dữ liệu người đang chọn là mới nhất

        const month = $('monthFilter').value;
        const allMonths = [...new Set(people.flatMap(p => p.records.map(r => r.date.slice(0, 7))))]
            .sort()
            .reverse(); // tháng mới nhất đứng đầu, giống file mẫu
        const months = (all || !month) ? allMonths : [month];

        const hasData = months.some(m => people.some(p => p.records.some(r => r.date.startsWith(m))));
        if (!hasData) {
            toast('Không có dữ liệu để xuất.');
            return;
        }

        try {
            const workbook = new ExcelJS.Workbook();
            const manyYears = new Set(months.map(m => m.slice(0, 4))).size > 1;

            for (const m of months) {
                const [y, mon] = m.split('-').map(Number);
                buildAttendanceSheet(workbook, manyYears ? `Tháng ${mon}-${y}` : `Tháng ${mon}`, m);
            }

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = all || months.length > 1
                ? 'cham-cong-toan-bo.xlsx'
                : `cham-cong-${months[0]}.xlsx`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            toast('Đã xuất file Excel bảng chấm công.');
        } catch (e) {
            toast('Xuất file Excel bị lỗi, hãy thử lại.');
        }
    }

    /* =====================================================
       8. XỬ LÝ SỰ KIỆN
       ===================================================== */

    // --- Lưu chấm công ---
    function saveRecord() {
        const date = $('workDate').value;
        if (!date) {
            toast('Hãy chọn ngày.');
            return;
        }

        const sunday = isSunday(date);
        const checked = document.querySelector('input[name="workType"]:checked');
        const value = sunday ? 0 : Number(checked?.value || 0);
        const overtimeHours = Number($('overtimeHours').value) || 0;
        const sundayHours = Number($('sundayHours').value) || 0;

        if ([overtimeHours, sundayHours].some(n => n < 0 || !Number.isFinite(n))) {
            toast('Vui lòng nhập số hợp lệ.');
            return;
        }
        if (!sunday && sundayHours > 0) {
            toast('Giờ làm Chủ nhật chỉ nhập vào ngày Chủ nhật.');
            return;
        }

        const entry = {
            date,
            value,
            note: $('note').value.trim(),
            overtimeHours,
            overtimePay: 0,
            sundayHours,
            sundayPay: 0,
            legacySundayPay: 0,
            kind: sunday ? 'sunday' : 'normal'
        };

        const index = records.findIndex(r => r.date === date);
        if (index >= 0) records[index] = entry;
        else records.push(entry);

        if (!persist()) return;

        records.sort(byDateAsc);
        $('monthFilter').value = date.slice(0, 7);
        render();

        $('note').value = '';
        $('overtimeHours').value = '';
        $('sundayHours').value = '';
        toast(index >= 0 ? 'Đã cập nhật bản ghi ngày công.' : 'Đã lưu chấm công.');
    }

    // --- Quản lý nhân sự ---
    function switchPerson() {
        activeId = $('personSelect').value;
        loadActive();
        persist();
        renderPeople();
        render();
        toast('Đã chuyển người chấm công.');
    }

    /** Hỏi tên; trả về tên hợp lệ hoặc null nếu hủy/để trống */
    function askName(message, defaultValue) {
        const input = prompt(message, defaultValue);
        if (input === null) return null;
        const name = input.trim();
        if (!name) {
            toast('Tên không được để trống.');
            return null;
        }
        return name;
    }

    function addPerson() {
        const name = askName('Nhập tên nhân viên / người mới:', '');
        if (!name) return;

        const person = {
            id: 'p' + Date.now() + Math.random().toString(36).slice(2, 7),
            name,
            records: []
        };
        people.push(person);
        activeId = person.id;
        loadActive();
        persist();
        renderPeople();
        render();
        toast('Đã thêm ' + name + '.');
    }

    function renamePerson() {
        const person = activePerson();
        const name = askName('Sửa tên:', person.name);
        if (!name) return;

        person.name = name;
        persist();
        renderPeople();
        render();
        toast('Đã cập nhật tên.');
    }

    function deletePerson() {
        if (people.length === 1) {
            toast('Cần giữ lại ít nhất một người.');
            return;
        }
        const person = activePerson();
        if (!confirm('Xóa ' + person.name + ' và toàn bộ dữ liệu chấm công của người này?')) return;

        people = people.filter(p => p.id !== person.id);
        activeId = people[0].id;
        loadActive();
        persist();
        renderPeople();
        render();
        toast('Đã xóa ' + person.name + '.');
    }

    /* =====================================================
       9. KHỞI CHẠY
       ===================================================== */
    function init() {
        const now = new Date();
        $('todayLabel').textContent = now.toLocaleDateString('vi-VN', {
            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
        });
        $('workDate').value = localISO(now);
        $('monthFilter').value = localISO(now).slice(0, 7);

        loadPeople();
        loadActive();

        $('saveBtn').addEventListener('click', saveRecord);
        $('personSelect').addEventListener('change', switchPerson);
        $('addPerson').addEventListener('click', addPerson);
        $('renamePerson').addEventListener('click', renamePerson);
        $('deletePerson').addEventListener('click', deletePerson);
        $('workDate').addEventListener('change', updateDayType);
        $('monthFilter').addEventListener('change', render);
        $('exportMonth').addEventListener('click', () => exportExcel(false));
        $('exportAll').addEventListener('click', () => exportExcel(true));

        // Bấm vào bất kỳ đâu trên ô ngày/tháng đều mở lịch chọn
        for (const id of ['workDate', 'monthFilter']) {
            $(id).addEventListener('click', e => {
                try { e.currentTarget.showPicker(); } catch (err) {}
            });
        }

        renderPeople();
        updateDayType();
        render();
    }

    init();
})();
