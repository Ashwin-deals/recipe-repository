import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { enqueue, flushQueue, loadQueue, QUEUE_KEY, saveQueue } from "./offlineQueue";

describe("offline queue", () => {
  it("stores the latest desired state per item", () => {
    enqueue(3, true);
    enqueue(4, true);
    enqueue(3, false);
    expect(loadQueue()).toEqual({ "3": false, "4": true });
  });

  it("ignores corrupt or foreign storage", () => {
    localStorage.setItem(QUEUE_KEY, "not json");
    expect(loadQueue()).toEqual({});
    localStorage.setItem(QUEUE_KEY, JSON.stringify({ "1": true, "2": "yes", "3": null }));
    expect(loadQueue()).toEqual({ "1": true });
    localStorage.setItem(QUEUE_KEY, "[1,2]");
    expect(loadQueue()).toEqual({});
  });

  it("sends every queued change and empties the queue", async () => {
    saveQueue({ "1": true, "2": false });
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await flushQueue(send);
    expect(send.mock.calls).toEqual([[1, true], [2, false]]);
    expect(result).toMatchObject({ synced: [[1, true], [2, false]], offline: false, remaining: {} });
    expect(loadQueue()).toEqual({});
  });

  it("stops and keeps everything while offline", async () => {
    saveQueue({ "1": true, "2": true });
    const send = vi.fn().mockRejectedValue(new ApiError("offline", 0));
    const result = await flushQueue(send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.offline).toBe(true);
    expect(result.remaining).toEqual({ "1": true, "2": true });
  });

  it("drops changes the server rejects, such as cleared items", async () => {
    saveQueue({ "1": true, "2": true });
    const send = vi.fn()
      .mockRejectedValueOnce(new ApiError("That item is no longer on the list.", 404))
      .mockResolvedValueOnce(undefined);
    const result = await flushQueue(send);
    expect(result).toMatchObject({ dropped: [1], synced: [[2, true]], remaining: {} });
  });

  it("keeps a change the user made again while it was being sent", async () => {
    saveQueue({ "1": true });
    const send = vi.fn(async () => {
      enqueue(1, false); // user unticks while the request is in flight
    });
    const result = await flushQueue(send);
    expect(result.synced).toEqual([[1, true]]);
    expect(result.remaining).toEqual({ "1": false });
  });

  it("treats unknown errors as offline so nothing is lost", async () => {
    saveQueue({ "1": true });
    const result = await flushQueue(vi.fn().mockRejectedValue(new Error("boom")));
    expect(result.offline).toBe(true);
    expect(loadQueue()).toEqual({ "1": true });
  });
});
