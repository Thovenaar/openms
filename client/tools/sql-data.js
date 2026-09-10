/** Limited MySQL data reader, never a SQL executor. Limits are conversion policy. */
export const MAX_SQL_BYTES = 16000000;
const MAX_TOKENS = 2000000;
const MAX_STATEMENTS = 4096;
const MAX_ROWS = 100000;
const MAX_COLUMNS = 256;
const MAX_DEPTH = 32;

function tokenize(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_SQL_BYTES) {
    throw new Error("SQL input exceeds byte limit or is not text");
  }
  const tokens = [];
  const pattern =
    /\s+|--(?=\s)[^\r\n]*|#[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\[\s\S]|'')*'|"(?:[^"\\]|\\[\s\S]|"")*"|`(?:[^`]|``)*`|[A-Za-z_][A-Za-z_0-9]*|[+-]?\d+(?:\.\d+)?|[(),;=.]/gy;
  for (let count = 0; pattern.lastIndex < text.length; count++) {
    if (count >= MAX_TOKENS) throw new Error("SQL token limit");
    const offset = pattern.lastIndex;
    const match = pattern.exec(text);
    if (!match) {
      throw new Error(
        `Unsupported SQL token at byte/character offset ${offset}`,
      );
    }
    const token = match[0];
    if (/^\s|^--|^#|^\/\*/.test(token)) {
      if (/^\/\*[!+]/.test(token)) {
        throw new Error("Executable SQL comments unsupported");
      }
      continue;
    }
    tokens.push(token);
  }
  return tokens;
}

function identifier(token) {
  const name = token?.startsWith("`") ? token.slice(1, -1) : token;
  if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name ?? "")) {
    throw new Error(`Unsupported SQL identifier: ${token}`);
  }
  return name;
}

/** Split a parenthesized list without recursion; return its exclusive end. */
function group(tokens, start) {
  if (tokens[start] !== "(") throw new Error("Expected SQL parenthesized list");
  const parts = [];
  let depth = 1,
    first = start + 1;
  for (let index = first; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "(") depth++;
    if (depth > MAX_DEPTH) throw new Error("SQL nesting limit");
    if (token === ")") depth--;
    if ((token === "," && depth === 1) || depth === 0) {
      if (first === index) throw new Error("Empty SQL list entry");
      if (parts.length >= MAX_COLUMNS) throw new Error("SQL column limit");
      parts.push(tokens.slice(first, index));
      first = index + 1;
    }
    if (depth === 0) return { parts, end: index + 1 };
  }
  throw new Error("Unclosed SQL list");
}

function createTable(tokens) {
  const table = identifier(tokens[2]);
  const body = group(tokens, 3);
  if (body.end !== tokens.length) {
    throw new Error("CREATE TABLE suffix unsupported");
  }
  const columns = [],
    constraints = [];
  const names = new Set();
  for (const part of body.parts) {
    if (
      /^(PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|CHECK)$/i.test(part[0])
    ) {
      constraints.push(part.join(" "));
      continue;
    }
    const name = identifier(part[0]);
    if (names.has(name) || part.length < 2) {
      throw new Error("Invalid SQL column definition");
    }
    names.add(name);
    columns.push({ name, definition: part.slice(1).join(" ") });
  }
  return { table, columns, constraints };
}

function literal(tokens) {
  if (tokens.length !== 1) {
    throw new Error("SQL expressions/subqueries unsupported");
  }
  const token = tokens[0];
  if (/^NULL$/i.test(token)) return null;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(token)) {
    const number = Number(token);
    if (
      !Number.isFinite(number) ||
      (!token.includes(".") && !Number.isSafeInteger(number))
    ) {
      throw new Error("SQL number cannot be represented exactly");
    }
    return number;
  }
  const quote = token[0];
  if (quote !== "'" && quote !== '"') {
    throw new Error("Nonliteral SQL value unsupported");
  }
  const escaped = { 0: "\0", b: "\b", n: "\n", r: "\r", t: "\t", Z: "\x1a" };
  return token.slice(1, -1).replace(/\\([\s\S])|''|""/g, (match, escape) => {
    if (escape !== undefined) return escaped[escape] ?? escape;
    return match[0] === quote ? quote : match;
  });
}

function insertHeader(tokens) {
  const table = identifier(tokens[2]);
  const header = group(tokens, 3);
  const columns = header.parts.map((part) => {
    if (part.length !== 1) throw new Error("Invalid INSERT column");
    return identifier(part[0]);
  });
  if (
    new Set(columns.map((name) => name.toLowerCase())).size !== columns.length
  ) {
    throw new Error("Duplicate INSERT column");
  }
  if (tokens[header.end]?.toUpperCase() !== "VALUES") {
    throw new Error("Only INSERT VALUES supported");
  }
  return { table, columns, start: header.end + 1 };
}

function insertRows(tokens) {
  const { table, columns, start } = insertHeader(tokens);
  const rows = [];
  let index = start,
    rowCount = 0,
    reason = null;
  for (; index < tokens.length; rowCount++) {
    if (rowCount >= MAX_ROWS) throw new Error("SQL row limit");
    const tuple = group(tokens, index);
    if (tuple.parts.length !== columns.length) {
      throw new Error("INSERT row width mismatch");
    }
    try {
      rows.push(tuple.parts.map(literal));
    } catch (error) {
      reason ??= error.message;
    }
    index = tuple.end;
    if (index === tokens.length) break;
    if (tokens[index] !== "," || index + 1 === tokens.length) {
      throw new Error("Unsupported INSERT suffix");
    }
    index++;
  }
  if (!rows.length && reason === null) throw new Error("Empty INSERT VALUES");
  return {
    table,
    columns,
    rows: reason ? null : rows,
    rowCount: rowCount + 1,
    reason,
  };
}

/**
 * Parse CREATE TABLE declarations and explicit-column INSERT literal tuples.
 * Unsupported statements are reported, never silently interpreted or executed.
 * Schema defaults/constraints are descriptive SQL, not synthesized row values.
 */
export function parseSql(text) {
  const tokens = tokenize(text);
  const result = {
    schemas: [],
    inserts: [],
    unsupported: [],
    statementCount: 0,
  };
  let first = 0,
    totalRows = 0;
  for (let index = 0; index <= tokens.length; index++) {
    if (index < tokens.length && tokens[index] !== ";") continue;
    if (index === first) {
      first = index + 1;
      continue;
    }
    if (result.statementCount >= MAX_STATEMENTS) {
      throw new Error("SQL statement limit");
    }
    const statement = tokens.slice(first, index);
    first = index + 1;
    const number = ++result.statementCount;
    const kind = statement.slice(0, 2).join(" ").toUpperCase();
    try {
      if (kind === "CREATE TABLE") result.schemas.push(createTable(statement));
      else if (kind === "INSERT INTO") {
        const insert = insertRows(statement);
        result.inserts.push(insert);
        totalRows += insert.rowCount;
        if (totalRows > MAX_ROWS) throw new Error("SQL total row limit");
        if (insert.reason) {
          result.unsupported.push({
            statement: number,
            kind,
            table: insert.table,
            reason: insert.reason,
          });
        }
      } else throw new Error("Statement kind unsupported");
    } catch (error) {
      result.unsupported.push({
        statement: number,
        kind,
        reason: error.message,
      });
    }
  }
  if (totalRows > MAX_ROWS) throw new Error("SQL total row limit");
  return result;
}
