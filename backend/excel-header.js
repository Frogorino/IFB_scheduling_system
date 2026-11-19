function normalizeHeader(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function findScheduleHeaderRow(rows) {
    let bestIndex = -1;
    let bestScore = 0;

    rows.slice(0, 30).forEach((row, index) => {
        const headers = row.map(normalizeHeader).filter(Boolean);
        const hasCustomer = headers.some(header => header === "customer" || header.startsWith("customer "));
        const hasPartNumber = headers.some(header =>
            /^(?:part|part no|part number|part no number)$/.test(header)
        );
        if (!hasCustomer || !hasPartNumber) return;

        const monthCount = headers.filter(header => /^[a-z]+\s+\d{2,4}$/.test(header)).length;
        const score = 6 + Math.min(monthCount, 3);
        if (score > bestScore) {
            bestIndex = index;
            bestScore = score;
        }
    });

    return bestIndex;
}

function getScheduleRecords(sheet, xlsx) {
    const sheetRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    const headerRow = findScheduleHeaderRow(sheetRows);
    return xlsx.utils.sheet_to_json(sheet, {
        range: headerRow === -1 ? 0 : headerRow,
        defval: "",
        raw: false
    });
}

module.exports = { findScheduleHeaderRow, getScheduleRecords };
