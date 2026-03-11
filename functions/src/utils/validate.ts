// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function requireFields(
  body: Record<string, unknown>,
  fields: string[],
  res: any
): boolean {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length > 0) {
    res.status(400).json({
      error: 'validation_error',
      message: `Missing required fields: ${missing.join(', ')}`,
    });
    return false;
  }
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validateEnum(
  value: unknown,
  allowed: readonly string[],
  fieldName: string,
  res: any
): boolean {
  if (value !== undefined && !allowed.includes(value as string)) {
    res.status(400).json({
      error: 'validation_error',
      message: `Invalid ${fieldName}: must be one of ${allowed.join(', ')}`,
    });
    return false;
  }
  return true;
}
