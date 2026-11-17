export function fieldMessageIds(fieldId: string) {
  return {
    hintId: `${fieldId}-hint`,
    errorId: `${fieldId}-error`,
  } as const;
}

export function mergeDescribedBy(
  ...ids: Array<string | null | undefined | false>
): string | undefined {
  const tokens = ids
    .flatMap((entry) => (typeof entry === "string" ? entry.trim().split(/\s+/) : []))
    .filter(Boolean);

  if (tokens.length === 0) {
    return undefined;
  }

  return [...new Set(tokens)].join(" ");
}

export function buildFieldDescribedBy(options: {
  fieldId: string;
  hasHint?: boolean;
  hasError?: boolean;
  extraDescribedBy?: string;
}): string | undefined {
  const { hintId, errorId } = fieldMessageIds(options.fieldId);

  return mergeDescribedBy(
    options.hasHint ? hintId : undefined,
    options.hasError ? errorId : undefined,
    options.extraDescribedBy,
  );
}

export function passwordToggleState(visible: boolean): Readonly<{
  inputType: "text" | "password";
  buttonLabel: string;
  announcement: string;
}> {
  return visible
    ? {
        inputType: "text",
        buttonLabel: "Hide password",
        announcement: "Password is visible.",
      }
    : {
        inputType: "password",
        buttonLabel: "Show password",
        announcement: "Password is hidden.",
      };
}
