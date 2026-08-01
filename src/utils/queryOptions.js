const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE));
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

// sortMap maps a public query param value to the actual (table-qualified) SQL
// column, so user input never reaches the query as a raw identifier.
function parseSort(query, sortMap, defaultKey, defaultOrder = 'asc') {
  const key = Object.prototype.hasOwnProperty.call(sortMap, query.sort) ? query.sort : defaultKey;
  const rawOrder = query.order ? String(query.order).toLowerCase() : defaultOrder;
  const direction = rawOrder === 'desc' ? 'DESC' : 'ASC';
  return `${sortMap[key]} ${direction}`;
}

// expects each row to carry a `total_count` column from `COUNT(*) OVER()`
function buildListResponse(rows, { page, pageSize }) {
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  const data = rows.map(({ total_count, ...rest }) => rest);
  return { data, meta: { page, pageSize, total } };
}

module.exports = { parsePagination, parseSort, buildListResponse };
