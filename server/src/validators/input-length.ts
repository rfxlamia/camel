export interface ValidationResult {
  valid: boolean;
  trimmed?: string;
  error?: string;
}

export const MAX_LENGTHS = {
  cardTitle: 255,
  cardDescription: 10000,
  boardName: 100,
  displayName: 50,
  username: 32,
  usernameMin: 3,
  workspaceName: 100,
  columnName: 50,
} as const;

export function validateCardTitle(title: string): ValidationResult {
  if (typeof title !== 'string') {
    return { valid: false, error: 'title must be a string' };
  }

  const trimmed = title.trim();
  if (trimmed === '') {
    return { valid: false, error: 'title is required' };
  }

  if (trimmed.length > MAX_LENGTHS.cardTitle) {
    return {
      valid: false,
      error: `title must be ${MAX_LENGTHS.cardTitle} characters or less`,
    };
  }

  return { valid: true, trimmed };
}

export function validateCardDescription(description: string): ValidationResult {
  if (typeof description !== 'string') {
    return { valid: false, error: 'description must be a string' };
  }

  if (description === '') {
    return { valid: true, trimmed: '' };
  }

  const trimmed = description.trim();
  if (trimmed.length > MAX_LENGTHS.cardDescription) {
    return {
      valid: false,
      error: `description must be ${MAX_LENGTHS.cardDescription} characters or less`,
    };
  }

  return { valid: true, trimmed };
}

export function validateBoardName(name: string): ValidationResult {
  if (typeof name !== 'string') {
    return { valid: false, error: 'name must be a string' };
  }

  const trimmed = name.trim();
  if (trimmed === '') {
    return { valid: false, error: 'Name is required' };
  }

  if (trimmed.length > MAX_LENGTHS.boardName) {
    return {
      valid: false,
      error: `name must be ${MAX_LENGTHS.boardName} characters or less`,
    };
  }

  return { valid: true, trimmed };
}

export function validateDisplayName(name: string): ValidationResult {
  if (typeof name !== 'string') {
    return { valid: false, error: 'name must be a string' };
  }

  const trimmed = name.trim();
  if (trimmed.length > MAX_LENGTHS.displayName) {
    return {
      valid: false,
      error: `name must be ${MAX_LENGTHS.displayName} characters or less`,
    };
  }

  return { valid: true, trimmed: trimmed || undefined };
}

export function validateUsername(username: string): ValidationResult {
  if (typeof username !== 'string') {
    return { valid: false, error: 'username must be a string' };
  }

  const trimmed = username.trim();
  if (trimmed.length < MAX_LENGTHS.usernameMin) {
    return {
      valid: false,
      error: `username must be at least ${MAX_LENGTHS.usernameMin} characters`,
    };
  }

  if (trimmed.length > MAX_LENGTHS.username) {
    return {
      valid: false,
      error: `username must be ${MAX_LENGTHS.username} characters or less`,
    };
  }

  return { valid: true, trimmed };
}
