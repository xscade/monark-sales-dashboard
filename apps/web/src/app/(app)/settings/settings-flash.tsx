export function SettingsFlash({ notice, error }: { notice?: string; error?: string }) {
  return (
    <>
      {notice && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </>
  );
}
