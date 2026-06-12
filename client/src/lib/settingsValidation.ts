export function validateBoardName(name: string): { valid: false; error: string } | { valid: true; trimmed: string } {
  const trimmed = name.trim();
  if (trimmed === "") return { valid: false, error: "Name is required" };
  if (trimmed.length > 15) return { valid: false, error: "Max 15 characters" };
  return { valid: true, trimmed };
}

export function validateResetAppConfirmation(text: string, checkboxChecked: boolean): { enabled: boolean } {
  const trimmed = text.trim().toUpperCase();
  return { enabled: trimmed === "DELETE" && checkboxChecked };
}

export function validateUnsavedChanges(original: string, current: string): boolean {
  return original.trim() !== current.trim();
}
