import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useBoard } from "../context/BoardContext";
import LogoCropper from "../components/LogoCropper";
import {
  validateBoardName,
  validateResetAppConfirmation,
  validateUnsavedChanges,
} from "../lib/settingsValidation";

/** Collapsible section following creative-brief design tokens */
function SettingsSection({
  title,
  titleClassName = "text-neutral-800",
  defaultOpen = true,
  children,
}: {
  title: string;
  titleClassName?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-base font-medium text-left hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
        aria-expanded={isOpen}
      >
        <span className={titleClassName}>{title}</span>
        <svg
          className={`h-4 w-4 text-neutral-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="border-t border-neutral-200 p-4 space-y-6">
          {children}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { settings, settingsVersion, refreshSettings, showToast } = useBoard();

  const [boardNameInput, setBoardNameInput] = useState(settings.boardName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [cropImage, setCropImage] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showResetApp, setShowResetApp] = useState(false);
  const [resetText, setResetText] = useState("");
  const [resetChecked, setResetChecked] = useState(false);

  const [settingsLoadError, setSettingsLoadError] = useState(false);

  // Sync input when external settings change (e.g. after save, reset, SSE)
  useEffect(() => {
    setBoardNameInput(settings.boardName);
  }, [settings.boardName]);

  // Unsaved changes warning (gated by validateUnsavedChanges)
  useEffect(() => {
    const onBeforeUnload = (ev: BeforeUnloadEvent) => {
      if (validateUnsavedChanges(settings.boardName, boardNameInput)) {
        ev.preventDefault();
        ev.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [settings.boardName, boardNameInput]);

  const nameVal = validateBoardName(boardNameInput);
  const hasNameChange = validateUnsavedChanges(settings.boardName, boardNameInput);
  const canSaveName = nameVal.valid && hasNameChange && !isSaving;

  async function handleSaveName() {
    if (!nameVal.valid) {
      setNameError(nameVal.error);
      return;
    }
    setNameError(null);
    setIsSaving(true);
    try {
      await api.updateSettings([
        { key: "board_name", textValue: nameVal.trimmed, version: settingsVersion },
      ]);
      await refreshSettings();
      showToast("Settings saved");
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === "version_conflict") {
        showToast("Someone else updated settings first");
        await refreshSettings();
      } else {
        showToast("Couldn't save the settings. Check your connection and try again.");
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setLogoError(null);
    const file = e.target.files?.[0];
    // reset the input so same file can be re-selected if needed
    e.target.value = "";
    if (!file) return;

    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setLogoError("Only .png and .jpg files are accepted");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setLogoError("File size must be under 10MB");
      return;
    }

    const url = URL.createObjectURL(file);
    setCropImage(url);
  }

  async function handleCroppedLogo(blob: Blob) {
    const urlToRevoke = cropImage;
    setCropImage(null);

    const file = new File([blob], "logo.png", { type: "image/png" });
    try {
      await api.uploadLogo(file);
      await refreshSettings();
      showToast("Settings saved");
    } catch (err: unknown) {
      const msg =
        err instanceof ApiError ? err.message : "Upload failed. Please try again.";
      setLogoError(msg);
      showToast(msg);
    } finally {
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
    }
  }

  function handleCancelCrop() {
    if (cropImage) URL.revokeObjectURL(cropImage);
    setCropImage(null);
  }

  async function handleResetSettings() {
    setShowResetConfirm(false);
    try {
      await api.resetSettings();
      await refreshSettings();
      showToast("Settings reset to defaults");
    } catch {
      showToast("Failed to reset settings. Try again.");
    }
  }

  const resetAppVal = validateResetAppConfirmation(resetText, resetChecked);

  async function handleResetApp() {
    if (!resetAppVal.enabled) return;
    setShowResetApp(false);
    setResetText("");
    setResetChecked(false);
    try {
      await api.resetApp();
      await refreshSettings();
      showToast("App has been reset");
    } catch {
      showToast("Failed to reset app. Try again.");
    }
  }

  async function handleRetryLoad() {
    setSettingsLoadError(false);
    try {
      await refreshSettings();
    } catch {
      setSettingsLoadError(true);
    }
  }

  if (settingsLoadError) {
    return (
      <div className="p-6">
        <p className="text-error-600">Failed to load settings.</p>
        <button
          onClick={handleRetryLoad}
          className="mt-2 text-sm text-primary-600 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900">Settings</h1>

      {/* Identity section */}
      <SettingsSection title="Identity">
          {/* Board name */}
          <div>
            <label htmlFor="boardName" className="block text-sm font-medium text-neutral-700">
              Board name
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="boardName"
                type="text"
                value={boardNameInput}
                onChange={(e) => {
                  setBoardNameInput(e.target.value);
                  if (nameError) setNameError(null);
                }}
                maxLength={15}
                className={`flex-1 rounded-md border px-3 py-2 text-base focus:outline-none ${
                  nameVal.valid
                    ? "border-neutral-300 focus:border-primary-600"
                    : "border-error-500 focus:border-error-500"
                }`}
              />
              <button
                onClick={handleSaveName}
                disabled={!canSaveName}
                className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
            {nameError && <p className="mt-1 text-sm text-error-600">{nameError}</p>}
            {!nameVal.valid && !nameError && boardNameInput.trim() !== "" && (
              <p className="mt-1 text-sm text-error-600">{nameVal.error}</p>
            )}
            <p className="mt-1 text-xs text-neutral-500">1–15 characters. Saved changes appear in the sidebar and browser tab.</p>

            {/* Live preview */}
            <div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 text-sm">
              <span className="text-neutral-500">Sidebar preview: </span>
              <span className="font-semibold text-primary-900">
                {nameVal.valid ? nameVal.trimmed : settings.boardName}
              </span>
            </div>
          </div>

          {/* Logo */}
          <div>
            <div className="text-sm font-medium text-neutral-700">Logo</div>
            <div className="mt-2 flex items-start gap-4">
              <img
                src={settings.logoPath}
                alt={`${settings.boardName} logo`}
                className="h-16 w-16 shrink-0 rounded border border-neutral-200 bg-white object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = "/logo.png";
                }}
              />
              <div className="min-w-0">
                <label className="inline-flex cursor-pointer items-center rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-200 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-600">
                  Upload new logo
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sr-only"
                    onChange={handleLogoSelect}
                  />
                </label>
                <p className="mt-1 text-xs text-neutral-500">PNG or JPG, max 10 MB. Cropped to 1:1 square.</p>
                {logoError && <p className="mt-1 text-sm text-error-600">{logoError}</p>}
              </div>
            </div>
          </div>
      </SettingsSection>

      {/* Danger Zone */}
      <SettingsSection title="Danger Zone" titleClassName="text-error-700">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium text-neutral-800">Reset Settings</div>
              <div className="text-sm text-neutral-500">
                Revert board name and logo to defaults. Cards and columns are not affected.
              </div>
            </div>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="shrink-0 rounded-md border border-error-500 px-3 py-1.5 text-sm font-medium text-error-700 hover:bg-error-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error-500"
            >
              Reset Settings
            </button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium text-neutral-800">Reset App</div>
              <div className="text-sm text-neutral-500">
                Permanently delete all cards, columns, and settings. Users can still log in. Cannot be undone.
              </div>
            </div>
            <button
              onClick={() => {
                setShowResetApp(true);
                setResetText("");
                setResetChecked(false);
              }}
              className="shrink-0 rounded-md bg-error-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-error-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error-500"
            >
              Reset App
            </button>
          </div>
      </SettingsSection>

      {/* Reset Settings confirmation dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Confirm reset settings">
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
            <p className="font-medium text-neutral-800">Reset all settings to defaults?</p>
            <p className="mt-1 text-sm text-neutral-500">Board name reverts to “Camel”, logo to default. Your cards and columns stay intact.</p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                onClick={handleResetSettings}
                className="flex-1 rounded-md bg-error-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-error-600"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset App multi-step modal (gated by validateResetAppConfirmation) */}
      {showResetApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Confirm reset app">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h4 className="text-lg font-semibold text-error-700">Reset entire app?</h4>
            <p className="mt-1 text-sm text-neutral-600">
              This permanently deletes every card, column, and all settings. User accounts remain and you can log in again.
            </p>

            <div className="mt-4">
              <label htmlFor="resetConfirm" className="block text-sm font-medium text-neutral-700">
                Type DELETE to confirm
              </label>
              <input
                id="resetConfirm"
                type="text"
                value={resetText}
                onChange={(e) => setResetText(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-base focus:border-error-500 focus:outline-none"
                placeholder="DELETE"
                autoComplete="off"
              />
            </div>

            <label className="mt-3 flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={resetChecked}
                onChange={(e) => setResetChecked(e.target.checked)}
                className="mt-1 accent-error-500"
              />
              <span>I understand this cannot be undone</span>
            </label>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  setShowResetApp(false);
                  setResetText("");
                  setResetChecked(false);
                }}
                className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Cancel
              </button>
              <button
                onClick={handleResetApp}
                disabled={!resetAppVal.enabled}
                className="flex-1 rounded-md bg-error-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-error-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
              >
                Reset App
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logo cropper (opened after valid file select) */}
      {cropImage && (
        <LogoCropper
          image={cropImage}
          onCropComplete={handleCroppedLogo}
          onCancel={handleCancelCrop}
        />
      )}
    </div>
  );
}
