"use client";

import { useActionState } from "react";
import { createApiKey } from "@/lib/admin-actions";
import type { CreateApiKeyState } from "@/lib/admin-validation";

const initialState: CreateApiKeyState = { status: "idle" };
const fieldClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950";

export function ApiKeyCreateForm({ projects }: { projects: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createApiKey, initialState);

  return (
    <div className="space-y-4 p-5">
      <form action={action} autoComplete="off" className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Key name
            <input
              required
              name="name"
              maxLength={120}
              placeholder="Website production"
              className={fieldClass}
            />
          </label>
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Client policy
            <select name="keyPolicy" defaultValue="browser" className={fieldClass}>
              <option value="browser">Browser · bearer only</option>
              <option value="server">Server · HMAC required</option>
            </select>
          </label>
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Project scope
            <select name="projectId" defaultValue="" className={fieldClass}>
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Requests per minute
            <input
              required
              type="number"
              name="rateLimitPerMinute"
              min={1}
              max={10_000}
              defaultValue={120}
              className={fieldClass}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-xs leading-5 text-zinc-500">
            Browser keys support public forms and cannot require a secret. Server keys reject every
            unsigned request. All new keys receive only the <code>leads:write</code> scope.
          </p>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Creating…" : "Create key"}
          </button>
        </div>
      </form>

      {state.status === "error" && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {state.message}
        </div>
      )}

      {state.status === "success" && (
        <div role="status" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">{state.message}</p>
          <div>
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">Bearer API key</p>
            <code className="mt-1 block select-all break-all rounded bg-white p-3 text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
              {state.apiKey}
            </code>
          </div>
          <div>
            <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
              HMAC signing secret {state.signatureRequired ? "· required" : "· optional"}
            </p>
            <code className="mt-1 block select-all break-all rounded bg-white p-3 text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
              {state.signingSecret}
            </code>
          </div>
          <p className="text-xs leading-5 text-amber-800 dark:text-amber-200">
            {state.keyPolicy === "server"
              ? "Store both values server-side and sign every exact request body. "
              : "The bearer key may be used by a browser form; never embed the signing secret in client code. "}
            Reloading or leaving this page permanently removes this one-time display.
          </p>
        </div>
      )}
    </div>
  );
}
