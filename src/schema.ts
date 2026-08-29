// Vendored JSON-Schema-subset validator. Zero dependencies by design (RFC 0001 §7 PR1).
// Supported keywords: $ref (internal), type (string or array), enum, required, properties,
// additionalProperties (boolean), items (single schema), pattern, anyOf.
// Anything else in a schema is ignored — the case schema only uses this subset.

export interface SchemaError {
  path: string;
  keyword: string;
  message: string;
}

export type JsonSchema = Record<string, any>;

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value; // 'object' | 'string' | 'boolean'
}

function typeMatches(declared: string, actual: string): boolean {
  if (declared === actual) return true;
  if (declared === 'number' && actual === 'integer') return true;
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeOf(a) !== typeOf(b)) return false;
  if (Array.isArray(a)) {
    const bArr = b as unknown[];
    return a.length === bArr.length && a.every((v, i) => deepEqual(v, bArr[i]));
  }
  if (a !== null && typeof a === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const ak = Object.keys(aObj);
    const bk = Object.keys(bObj);
    return ak.length === bk.length && ak.every((k) => deepEqual(aObj[k], bObj[k]));
  }
  return false;
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema {
  if (!ref.startsWith('#/')) throw new Error(`only internal $refs are supported: ${ref}`);
  let node: any = root;
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part];
    if (node === undefined) throw new Error(`unresolvable $ref: ${ref}`);
  }
  return node;
}

/**
 * Validate `value` against `schema`. Returns an array of errors, empty when valid.
 * `path` is a JSON-pointer-ish dotted path into the value.
 */
export function validateSchema(schema: JsonSchema, value: unknown, root: JsonSchema = schema, path = ''): SchemaError[] {
  const at = path === '' ? '(root)' : path;

  if (schema.$ref) {
    return validateSchema(resolveRef(schema.$ref, root), value, root, path);
  }

  const errors: SchemaError[] = [];

  if (schema.anyOf) {
    const branches = (schema.anyOf as JsonSchema[]).map((s) => validateSchema(s, value, root, path));
    if (!branches.some((errs) => errs.length === 0)) {
      const reasons = branches.map((errs, i) => `[${i}] ${errs[0]?.message ?? 'invalid'}`).join('; ');
      errors.push({ path, keyword: 'anyOf', message: `${at}: no allowed form matches — ${reasons}` });
    }
    return errors; // anyOf schemas are self-contained in this subset
  }

  if (schema.enum) {
    if (!(schema.enum as unknown[]).some((allowed) => deepEqual(allowed, value))) {
      errors.push({ path, keyword: 'enum', message: `${at}: must be one of ${JSON.stringify(schema.enum)}` });
    }
    return errors;
  }

  if (schema.type) {
    const declared: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!declared.some((t) => typeMatches(t, actual))) {
      errors.push({ path, keyword: 'type', message: `${at}: expected ${declared.join(' | ')}, got ${actual}` });
      return errors; // structural keywords below assume the right type
    }
  }

  if (typeof value === 'string' && schema.pattern) {
    if (!new RegExp(schema.pattern).test(value)) {
      errors.push({ path, keyword: 'pattern', message: `${at}: ${JSON.stringify(value)} does not match ${schema.pattern}` });
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const valueObj = value as Record<string, unknown>;
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in valueObj)) {
        errors.push({ path, keyword: 'required', message: `${at}: missing required property "${key}"` });
      }
    }
    const props: Record<string, JsonSchema> = schema.properties ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in valueObj) {
        errors.push(...validateSchema(sub, valueObj[key], root, path ? `${path}.${key}` : key));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(valueObj)) {
        if (!(key in props)) {
          errors.push({ path: path ? `${path}.${key}` : key, keyword: 'additionalProperties', message: `${at}: unknown property "${key}"` });
        }
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      errors.push(...validateSchema(schema.items, item, root, `${path}[${i}]`));
    });
  }

  return errors;
}
