import { profileError } from "./profile-validation.js";

/** Strict plain-data boundaries shared by the non-tick profile domains. */
export function domainInvalid(path) {
  throw profileError("corrupt-profile", `Invalid saved profile: ${path}`);
}

export function domainKeys(value, fields, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    domainInvalid(path);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) domainInvalid(path);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length) domainInvalid(`${path} fields`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !fields.includes(key) ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    ) {
      domainInvalid(path);
    }
  }
}

export function domainInteger(value, min, max, path) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    domainInvalid(path);
  }
}

export function domainText(value, max, path, min = 0) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    domainInvalid(path);
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 && code !== 9 && code !== 10 && code !== 13) {
      domainInvalid(path);
    }
  }
}

export function domainId(value, path) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    domainInvalid(path);
  }
}

export function domainArray(value, max, path) {
  if (!Array.isArray(value) || value.length > max) domainInvalid(path);
  if (Reflect.ownKeys(value).length !== value.length + 1) domainInvalid(path);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      domainInvalid(path);
    }
  }
}

export function domainUnique(values, path) {
  if (new Set(values).size !== values.length) {
    domainInvalid(`${path} duplicates`);
  }
}
