import { z } from "zod";

export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const AUTH_PASSWORD_MAX_LENGTH = 128;
export const AUTH_NAME_MAX_LENGTH = 120;

export type AuthFieldName =
  | "name"
  | "email"
  | "password"
  | "confirmPassword";

export type AuthFieldErrors = Partial<Record<AuthFieldName, string>>;

export type AuthErrorInput = Readonly<{
  code?: string;
  status?: number;
  message?: string;
}>;

export type AuthValidationContext =
  | "sign-in"
  | "sign-up"
  | "forgot-password"
  | "reset-password";

const emailFormatSchema = z.email();

export function validateAuthEmail(value: string): string | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return "Enter your email address.";
  }

  if (!emailFormatSchema.safeParse(trimmed).success) {
    return "Enter a valid email address, such as owner@studio.ng.";
  }

  return undefined;
}

export function validateAuthName(value: string): string | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return "Enter your name so we can set up your business workspace.";
  }

  if (trimmed.length > AUTH_NAME_MAX_LENGTH) {
    return `Name must be ${AUTH_NAME_MAX_LENGTH} characters or fewer.`;
  }

  return undefined;
}

export function validateSignInPassword(value: string): string | undefined {
  if (!value) {
    return "Enter your password.";
  }

  if (value.length > AUTH_PASSWORD_MAX_LENGTH) {
    return `Password must be ${AUTH_PASSWORD_MAX_LENGTH} characters or fewer.`;
  }

  return undefined;
}

export function validateNewPassword(value: string): string | undefined {
  if (!value) {
    return "Enter a password.";
  }

  if (value.length < AUTH_PASSWORD_MIN_LENGTH) {
    return `Use at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`;
  }

  if (value.length > AUTH_PASSWORD_MAX_LENGTH) {
    return `Password must be ${AUTH_PASSWORD_MAX_LENGTH} characters or fewer.`;
  }

  return undefined;
}

export function validateConfirmPassword(
  password: string,
  confirmPassword: string,
): string | undefined {
  if (!confirmPassword) {
    return "Re-enter your new password to confirm it.";
  }

  if (confirmPassword !== password) {
    return "Passwords do not match. Enter the same password in both fields.";
  }

  return undefined;
}

export function validateAuthFormFields(
  context: "sign-in" | "sign-up",
  values: Readonly<{ name: string; email: string; password: string }>,
): AuthFieldErrors {
  const errors: AuthFieldErrors = {};

  if (context === "sign-up") {
    const nameError = validateAuthName(values.name);
    if (nameError) {
      errors.name = nameError;
    }
  }

  const emailError = validateAuthEmail(values.email);
  if (emailError) {
    errors.email = emailError;
  }

  const passwordError =
    context === "sign-up"
      ? validateNewPassword(values.password)
      : validateSignInPassword(values.password);
  if (passwordError) {
    errors.password = passwordError;
  }

  return errors;
}

export function validateResetPasswordFields(
  values: Readonly<{ password: string; confirmPassword: string }>,
): AuthFieldErrors {
  const errors: AuthFieldErrors = {};

  const passwordError = validateNewPassword(values.password);
  if (passwordError) {
    errors.password = passwordError;
  }

  const confirmError = validateConfirmPassword(
    values.password,
    values.confirmPassword,
  );
  if (confirmError) {
    errors.confirmPassword = confirmError;
  }

  return errors;
}

export function mapAuthServerError(
  error: AuthErrorInput | null | undefined,
  context: AuthValidationContext,
): Readonly<{ fieldErrors: AuthFieldErrors; formError: string | null }> {
  const code = error?.code ?? "";

  if (error?.status === 429 || code.includes("RATE_LIMIT")) {
    return {
      fieldErrors: {},
      formError:
        "Too many attempts. Wait about a minute, then try again.",
    };
  }

  if (
    code.includes("USER_ALREADY_EXISTS") ||
    code.includes("EMAIL_ALREADY_EXISTS")
  ) {
    return {
      fieldErrors: {
        email: "An account with this email already exists. Sign in instead.",
      },
      formError: null,
    };
  }

  if (code.includes("INVALID_EMAIL_OR_PASSWORD") || error?.status === 401) {
    return {
      fieldErrors: {},
      formError:
        "Email or password is incorrect. Check your details or reset your password.",
    };
  }

  if (code.includes("INVALID_PASSWORD")) {
    return {
      fieldErrors: {
        password: "That password is incorrect. Check it and try again.",
      },
      formError: null,
    };
  }

  if (code.includes("INVALID_EMAIL")) {
    return {
      fieldErrors: {
        email: "Enter a valid email address, such as owner@studio.ng.",
      },
      formError: null,
    };
  }

  if (code.includes("PASSWORD_TOO_SHORT")) {
    return {
      fieldErrors: {
        password: `Use at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`,
      },
      formError: null,
    };
  }

  if (code.includes("PASSWORD_TOO_LONG")) {
    return {
      fieldErrors: {
        password: `Password must be ${AUTH_PASSWORD_MAX_LENGTH} characters or fewer.`,
      },
      formError: null,
    };
  }

  if (
    code.includes("INVALID_TOKEN") ||
    code.includes("EXPIRED") ||
    code.includes("USER_NOT_FOUND")
  ) {
    return {
      fieldErrors: {},
      formError:
        "This password reset link is invalid, expired, or already used. Request a new link to continue.",
    };
  }

  if (code.includes("RESET_PASSWORD_DISABLED")) {
    return {
      fieldErrors: {},
      formError:
        "Password reset is not available right now. Contact your workspace administrator.",
    };
  }

  const fallbackByContext: Record<AuthValidationContext, string> = {
    "sign-in": "Unable to sign in. Check your details and try again.",
    "sign-up":
      "Unable to create your account. Check your details and try again.",
    "forgot-password":
      "Unable to send reset instructions right now. Please try again.",
    "reset-password":
      "Unable to update your password. Request a new reset link and try again.",
  };

  return {
    fieldErrors: {},
    formError: fallbackByContext[context],
  };
}
