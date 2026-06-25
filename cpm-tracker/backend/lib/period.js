const PRESET_DAYS = [7, 28, 90, 365];

function parsePeriod(req) {
  const periodParam = req.query.period;
  if (periodParam === "custom") {
    const { start, end } = req.query;
    if (!start || !end) {
      throw Object.assign(new Error("start and end are required for a custom period"), { status: 400 });
    }
    const startDate = new Date(`${start}T00:00:00.000Z`);
    const endDate = new Date(`${end}T23:59:59.999Z`);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw Object.assign(new Error("Invalid start or end date"), { status: 400 });
    }
    return { startDate, endDate };
  }
  if (periodParam && periodParam !== "all") {
    const days = Number(periodParam);
    if (!PRESET_DAYS.includes(days)) {
      throw Object.assign(new Error("Invalid period"), { status: 400 });
    }
    return { startDate: new Date(Date.now() - days * 86400000), endDate: null };
  }
  return { startDate: null, endDate: null };
}

function isInPeriod(publishedAt, startDate, endDate) {
  if (!startDate) return true;
  if (!publishedAt) return false;
  const t = new Date(publishedAt).getTime();
  if (t < startDate.getTime()) return false;
  if (endDate && t > endDate.getTime()) return false;
  return true;
}

module.exports = { PRESET_DAYS, parsePeriod, isInPeriod };
