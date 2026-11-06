import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UpdateSection from "./UpdateSection";
import { systemApi } from "./api";
import type { UpdateStatusDTO } from "@/platform/api/types";

const base: UpdateStatusDTO = {
  enabled: true, auto: true, current: "auto-8", latest: "auto-9", available: true,
  state: "idle", last_checked: "2026-11-06T10:00:00Z", error: "", writable: true,
};

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UpdateSection notify={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("UpdateSection", () => {
  const reload = vi.fn();
  beforeEach(() => {
    reload.mockReset();
    vi.stubGlobal("location", { ...window.location, reload });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reloads once the restarted program answers after the install", async () => {
    const answers: (UpdateStatusDTO | Error)[] = [
      { ...base, state: "restarting" },
      new Error("connection reset"), // the program is down
      { ...base, current: "auto-9", latest: "", available: false, state: "idle" }, // the new program
    ];
    vi.spyOn(systemApi, "update").mockImplementation(() => {
      const next = answers.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next ?? base);
    });
    // The very first load (before the install) sees the old program.
    vi.mocked(systemApi.update).mockImplementationOnce(() => Promise.resolve(base));
    vi.spyOn(systemApi, "applyUpdate").mockResolvedValue({ ...base, state: "downloading" });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /Оновити й перезапустити/ }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: 8000 });
  });

  it("does not reload when the install fails and shows the reason", async () => {
    vi.spyOn(systemApi, "update").mockResolvedValueOnce(base).mockResolvedValue({ ...base, state: "error", error: "контрольна сума не збігається" });
    vi.spyOn(systemApi, "applyUpdate").mockResolvedValue({ ...base, state: "downloading" });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /Оновити й перезапустити/ }));
    expect(await screen.findByText(/контрольна сума не збігається/, undefined, { timeout: 8000 })).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it("offers nothing for a development build", async () => {
    vi.spyOn(systemApi, "update").mockResolvedValue({ ...base, enabled: false, current: "", latest: "", available: false });
    renderSection();
    expect(await screen.findByText(/не є випуском із GitHub/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Оновити й перезапустити/ })).toBeNull();
  });
});
