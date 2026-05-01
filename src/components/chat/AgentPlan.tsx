"use client";

import React, { useState, useCallback } from "react";
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleDotDashed,
  CircleX,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";

export interface Subtask {
  id: string;
  title: string;
  description: string;
  status: PlanStatus;
  priority: Priority;
  tools?: string[];
}

export interface PlanTask {
  id: string;
  title: string;
  description: string;
  status: PlanStatus;
  priority: Priority;
  level: number;
  dependencies: string[];
  subtasks: Subtask[];
}

export type PlanStatus =
  | "completed"
  | "in-progress"
  | "pending"
  | "need-help"
  | "failed";
export type Priority = "low" | "medium" | "high" | "critical";

interface AgentPlanProps {
  tasks: PlanTask[];
  title?: string;
  language?: "de" | "en";
  onTaskToggle?: (taskId: string, newStatus: PlanStatus) => void;
  onSubtaskToggle?: (taskId: string, subtaskId: string, newStatus: PlanStatus) => void;
}

const statusConfig: Record<
  PlanStatus,
  { icon: React.ReactNode; labelDe: string; labelEn: string; bg: string; text: string; border: string }
> = {
  completed: {
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
    labelDe: "Erledigt",
    labelEn: "Completed",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
  },
  "in-progress": {
    icon: <CircleDotDashed className="h-4 w-4 text-cyan-400" />,
    labelDe: "In Arbeit",
    labelEn: "In Progress",
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
    border: "border-cyan-500/30",
  },
  pending: {
    icon: <Circle className="h-4 w-4 text-slate-400" />,
    labelDe: "Ausstehend",
    labelEn: "Pending",
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/30",
  },
  "need-help": {
    icon: <CircleAlert className="h-4 w-4 text-amber-400" />,
    labelDe: "Hilfe nötig",
    labelEn: "Need Help",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/30",
  },
  failed: {
    icon: <CircleX className="h-4 w-4 text-rose-400" />,
    labelDe: "Fehlgeschlagen",
    labelEn: "Failed",
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-500/30",
  },
};

const priorityConfig: Record<Priority, { labelDe: string; labelEn: string; dot: string }> = {
  low: { labelDe: "Niedrig", labelEn: "Low", dot: "bg-slate-400" },
  medium: { labelDe: "Mittel", labelEn: "Medium", dot: "bg-blue-400" },
  high: { labelDe: "Hoch", labelEn: "High", dot: "bg-amber-400" },
  critical: { labelDe: "Kritisch", labelEn: "Critical", dot: "bg-rose-400" },
};

export default function AgentPlan({
  tasks,
  title,
  language = "de",
  onTaskToggle,
  onSubtaskToggle,
}: AgentPlanProps) {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(
    () => new Set(tasks.filter((t) => t.subtasks.length > 0).map((t) => t.id))
  );
  const [expandedSubtasks, setExpandedSubtasks] = useState<Set<string>>(new Set());

  const isDe = language === "de";

  const toggleTask = useCallback((taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const toggleSubtask = useCallback((taskId: string, subtaskId: string) => {
    const key = `${taskId}::${subtaskId}`;
    setExpandedSubtasks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleTaskStatusClick = useCallback(
    (e: React.MouseEvent, taskId: string) => {
      e.stopPropagation();
      const task = tasks.find((t) => t.id === taskId);
      if (!task || !onTaskToggle) return;
      const order: PlanStatus[] = ["pending", "in-progress", "completed", "need-help", "failed"];
      const idx = order.indexOf(task.status);
      const next = order[(idx + 1) % order.length];
      onTaskToggle(taskId, next);
    },
    [tasks, onTaskToggle]
  );

  const handleSubtaskStatusClick = useCallback(
    (e: React.MouseEvent, taskId: string, subtaskId: string) => {
      e.stopPropagation();
      const task = tasks.find((t) => t.id === taskId);
      const sub = task?.subtasks.find((s) => s.id === subtaskId);
      if (!sub || !onSubtaskToggle) return;
      const next = sub.status === "completed" ? "pending" : "completed";
      onSubtaskToggle(taskId, subtaskId, next);
    },
    [tasks, onSubtaskToggle]
  );

  const prefersReducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  return (
    <div className="w-full">
      {title && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300"
        >
          <span className="h-px flex-1 bg-gradient-to-r from-cyan-500/40 to-transparent" />
          <span className="text-cyan-400">{title}</span>
          <span className="h-px flex-1 bg-gradient-to-l from-cyan-500/40 to-transparent" />
        </motion.div>
      )}

      <LayoutGroup>
        <div className="space-y-1.5">
          {tasks.map((task, idx) => {
            const isExpanded = expandedTasks.has(task.id);
            const cfg = statusConfig[task.status];
            const pri = priorityConfig[task.priority];

            return (
              <motion.div
                key={task.id}
                layout={!prefersReducedMotion}
                initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: idx * 0.04,
                  duration: 0.25,
                  ease: [0.2, 0.65, 0.3, 0.9],
                }}
                className="overflow-hidden rounded border border-white/5 bg-white/[0.02] backdrop-blur-sm"
              >
                {/* Task Header */}
                <div
                  className="group flex cursor-pointer items-center gap-2 px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                  onClick={() => toggleTask(task.id)}
                >
                  {/* Expand Chevron */}
                  {task.subtasks.length > 0 ? (
                    <motion.div
                      animate={{ rotate: isExpanded ? 90 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-slate-500"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </motion.div>
                  ) : (
                    <div className="w-3.5" />
                  )}

                  {/* Status Icon */}
                  <button
                    onClick={(e) => handleTaskStatusClick(e, task.id)}
                    className="flex-shrink-0 transition-transform hover:scale-110 active:scale-95"
                  >
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={task.status}
                        initial={{ opacity: 0, scale: 0.7, rotate: -15 }}
                        animate={{ opacity: 1, scale: 1, rotate: 0 }}
                        exit={{ opacity: 0, scale: 0.7, rotate: 15 }}
                        transition={{ duration: 0.18 }}
                      >
                        {cfg.icon}
                      </motion.div>
                    </AnimatePresence>
                  </button>

                  {/* Title */}
                  <div className="min-w-0 flex-1">
                    <span
                      className={`text-sm font-medium ${
                        task.status === "completed"
                          ? "text-slate-500 line-through"
                          : "text-slate-200"
                      }`}
                    >
                      {task.title}
                    </span>
                  </div>

                  {/* Priority dot */}
                  <div className="flex items-center gap-1.5" title={isDe ? pri.labelDe : pri.labelEn}>
                    <span className={`h-1.5 w-1.5 rounded-full ${pri.dot}`} />
                  </div>

                  {/* Status Badge */}
                  <motion.span
                    key={task.status}
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cfg.bg} ${cfg.text} border ${cfg.border}`}
                  >
                    {isDe ? cfg.labelDe : cfg.labelEn}
                  </motion.span>

                  {/* Dependency badges */}
                  {task.dependencies.length > 0 && (
                    <div className="hidden flex-wrap gap-1 sm:flex">
                      {task.dependencies.map((dep) => (
                        <span
                          key={dep}
                          className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400"
                        >
                          #{dep}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Subtasks */}
                <AnimatePresence>
                  {isExpanded && task.subtasks.length > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.2, 0.65, 0.3, 0.9] }}
                      className="overflow-hidden"
                    >
                      {/* Connector line */}
                      <div className="relative px-3 pb-2">
                        <div className="absolute bottom-3 left-[26px] top-0 w-px bg-gradient-to-b from-cyan-500/20 to-transparent" />
                        <div className="space-y-0.5 pl-6">
                          {task.subtasks.map((sub, sIdx) => {
                            const subKey = `${task.id}::${sub.id}`;
                            const isSubExpanded = expandedSubtasks.has(subKey);
                            const subCfg = statusConfig[sub.status];

                            return (
                              <motion.div
                                key={sub.id}
                                initial={{ opacity: 0, x: prefersReducedMotion ? 0 : -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: sIdx * 0.03, duration: 0.2 }}
                              >
                                <div
                                  className="group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
                                  onClick={() => toggleSubtask(task.id, sub.id)}
                                >
                                  <button
                                    onClick={(e) =>
                                      handleSubtaskStatusClick(e, task.id, sub.id)
                                    }
                                    className="flex-shrink-0 transition-transform hover:scale-110 active:scale-95"
                                  >
                                    <AnimatePresence mode="wait">
                                      <motion.div
                                        key={sub.status}
                                        initial={{ opacity: 0, scale: 0.7 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.7 }}
                                        transition={{ duration: 0.15 }}
                                      >
                                        {subCfg.icon}
                                      </motion.div>
                                    </AnimatePresence>
                                  </button>

                                  <span
                                    className={`flex-1 text-xs ${
                                      sub.status === "completed"
                                        ? "text-slate-500 line-through"
                                        : "text-slate-300"
                                    }`}
                                  >
                                    {sub.title}
                                  </span>

                                  {sub.tools && sub.tools.length > 0 && (
                                    <div className="hidden flex-wrap gap-1 sm:flex">
                                      {sub.tools.slice(0, 2).map((tool) => (
                                        <span
                                          key={tool}
                                          className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[9px] text-cyan-400"
                                        >
                                          {tool}
                                        </span>
                                      ))}
                                      {sub.tools.length > 2 && (
                                        <span className="text-[9px] text-slate-500">
                                          +{sub.tools.length - 2}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  <span
                                    className={`text-[10px] ${subCfg.text}`}
                                  >
                                    {isDe ? subCfg.labelDe : subCfg.labelEn}
                                  </span>
                                </div>

                                {/* Subtask details */}
                                <AnimatePresence>
                                  {isSubExpanded && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.2 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="border-l border-dashed border-cyan-500/20 pb-2 pl-10 pt-1">
                                        <p className="text-xs leading-relaxed text-slate-400">
                                          {sub.description}
                                        </p>
                                        {sub.tools && sub.tools.length > 0 && (
                                          <div className="mt-2 flex flex-wrap gap-1.5">
                                            {sub.tools.map((tool) => (
                                              <span
                                                key={tool}
                                                className="rounded border border-cyan-500/20 bg-cyan-500/5 px-2 py-0.5 text-[10px] text-cyan-400"
                                              >
                                                {tool}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </LayoutGroup>

      {/* Summary footer */}
      {tasks.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-slate-500"
        >
          <span>
            {isDe
              ? `${tasks.filter((t) => t.status === "completed").length}/${tasks.length} Tasks erledigt`
              : `${tasks.filter((t) => t.status === "completed").length}/${tasks.length} tasks done`}
          </span>
          <span>
            {tasks.reduce((acc, t) => acc + t.subtasks.length, 0)}{" "}
            {isDe ? "Subtasks" : "subtasks"}
          </span>
        </motion.div>
      )}
    </div>
  );
}
