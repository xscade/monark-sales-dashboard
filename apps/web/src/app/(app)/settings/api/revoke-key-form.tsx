"use client";

import { revokeApiKey } from "@/lib/admin-actions";

export function RevokeKeyForm({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={revokeApiKey}
      onSubmit={(event) => {
        if (!window.confirm(`Revoke “${name}”? Requests using it will fail immediately.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-red-700"
      >
        Revoke
      </button>
    </form>
  );
}
