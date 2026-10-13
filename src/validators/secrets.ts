export interface SecretValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_SECRET_NAME_REGEX = /^[A-Z][A-Z0-9_]{2,64}$/;

/**
 * Validates that an identifier intended as a secret variable name follows safe conventions.
 * Never validates or receives secret VALUES, only names.
 */
export function validateSecretName(name: string): SecretValidationResult {
  const errors: string[] = [];

  if (!name || typeof name !== 'string') {
    errors.push('Secret name must be a non-empty string');
    return { valid: false, errors };
  }

  if (!VALID_SECRET_NAME_REGEX.test(name)) {
    errors.push(
      `Secret name "${name}" is invalid. Must be SCREAMING_SNAKE_CASE (uppercase letters, numbers, and underscores, starting with a letter).`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateRequiredSecretNames(names: string[]): SecretValidationResult {
  const allErrors: string[] = [];

  for (const name of names) {
    const res = validateSecretName(name);
    if (!res.valid) {
      allErrors.push(...res.errors);
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * Checks if required secret names are present in the provided environment map WITHOUT revealing their values.
 */
export function checkSecretNamesPresent(
  requiredNames: string[],
  env: NodeJS.ProcessEnv = process.env,
): { missing: string[]; present: string[] } {
  const missing: string[] = [];
  const present: string[] = [];

  for (const name of requiredNames) {
    const val = env[name];
    if (val && val.trim().length > 0) {
      present.push(name);
    } else {
      missing.push(name);
    }
  }

  return { missing, present };
}
