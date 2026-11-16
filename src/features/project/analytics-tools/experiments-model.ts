/** Experiment states as labels and badge tones. */
import type { ExperimentState } from "../api/analytics-tools";

export const EXPERIMENT_STATES: { value: ExperimentState; label: string }[] = [
	{ value: "EXPERIMENT_STATE_RUNNING", label: "Running" },
	{ value: "EXPERIMENT_STATE_SCHEDULED", label: "Scheduled" },
	{ value: "EXPERIMENT_STATE_DRAFT", label: "Draft" },
	{ value: "EXPERIMENT_STATE_COMPLETED", label: "Completed" },
	{ value: "EXPERIMENT_STATE_CANCELLED", label: "Cancelled" },
	{ value: "EXPERIMENT_STATE_DELETED", label: "Discarded" },
];

export function stateLabel(s: ExperimentState): string {
	return EXPERIMENT_STATES.find((x) => x.value === s)?.label ?? s.replace(/^EXPERIMENT_STATE_/, "").toLowerCase();
}

export function stateTone(s: ExperimentState): "good" | "brand" | "muted" | "warning" {
	return s === "EXPERIMENT_STATE_RUNNING" ? "good" : s === "EXPERIMENT_STATE_SCHEDULED" ? "brand" : s === "EXPERIMENT_STATE_DRAFT" ? "warning" : "muted";
}

/** "OPERATIONAL_STATUS_RAMPING_UP" -> "ramping up" */
export function operationalLabel(s: string | undefined): string {
	return (s ?? "").replace(/^OPERATIONAL_STATUS_/, "").toLowerCase().replace(/_/g, " ");
}
