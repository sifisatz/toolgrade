// Failure analysis written from the trial trajectories in benchmark/results/2026-11-16-qwen3-8b.
// Each finding names the task and score so it can be checked against the raw reports.

export interface Finding {
  server: string;
  task: string;
  score: string;
  title: string;
  observed: string;
  lesson: string;
}

export const FINDINGS: Finding[] = [
  {
    server: "everything",
    task: "no-tool-needed",
    score: "1/3 with tools vs 3/3 baseline",
    title: "Even one control task was not safe from tool-surface distraction",
    observed:
      "The suite's 16 tools include get-sum, a plain addition tool. On the control task (17 * 23, no tools allowed) two of three trials called it anyway instead of just answering, the same distraction pattern seen in sequential-thinking but on a much smaller, simpler tool.",
    lesson:
      "A control task earns its keep: it is the only place in this benchmark that isolates tool-surface distraction from everything else the agent is doing.",
  },
  {
    server: "everything",
    task: "chicago-weather",
    score: "0/3 with tools, this one is a task bug",
    title: "The prompt asked for 'the weather tool' - no tool is named that",
    observed:
      "All three trials answered 'no weather tool is available' and stopped, correctly: the real tool is get-structured-content, whose name and description never mention weather. The prompt presumed a tool identity the server does not expose.",
    lesson:
      "A benchmark task that names a capability the server does not literally advertise is testing the task's wording, not the agent. Left in deliberately, like the pandoc finding below - read the trajectory before trusting a 0% score.",
  },
  {
    server: "excel",
    task: "mark-shipped, add-order",
    score: "0/3 with tools, zero tool calls",
    title: "46 tools in context, and the one it needed went unseen",
    observed:
      "Faced with excel-mcp-server's full 46-tool, ~13.5k-token surface, the model concluded 'none of the provided functions support direct cell modification' and answered without calling anything - write_range was in that same list.",
    lesson:
      "Tool-surface size is not free. A server that groups or searches its tools instead of listing all of them flat would very likely change this for smaller models.",
  },
  {
    server: "excel",
    task: "top-customer",
    score: "0/3 with tools",
    title: "Reached for the complex tool, not the simple one",
    observed:
      "Instead of read_range, the model called create_pivot_table with an invented sort_by argument that tool does not accept, got a validation error back, and gave up rather than retrying with something simpler.",
    lesson:
      "A validation error is a second chance, not a dead end - but only if the agent (or the suite's max_turns) gives it room to take it.",
  },
  {
    server: "pandoc",
    task: "markdown-to-latex",
    score: "0/3 with tools vs 3/3 baseline, this one is a task bug",
    title: "The task asked for something the tool cannot do inline",
    observed:
      "convert-contents requires an explicit output_file for LaTeX output. Two of three trials correctly told the user exactly that and stopped; the third supplied its own output path, got a real conversion back, and still failed only because it wrote \\section*{Title} where the check expected \\section{Title}.",
    lesson:
      "The model handled this task more carefully than the suite did. An unexplained regression is worth reading the trajectory for before it goes in a findings list - this one almost did not.",
  },
  {
    server: "sequential-thinking",
    task: "all reasoning tasks",
    score: "no lift",
    title: "The model solved everything without the scaffold",
    observed:
      "All five multi-step problems passed 3/3 with and without the tool, so lift is zero. The model still made about 0.7 tool calls per task, and once called it for 17 * 23 - right answer, but a tool call the control task does not allow.",
    lesson:
      "A reasoning scaffold has to beat the model thinking alone. Here it added calls and tokens with no accuracy gain - harder problems or weaker models may differ, which is exactly what a no-tool baseline is for.",
  },
  {
    server: "memory",
    task: "recall-lead",
    score: "0/3 with tools",
    title: "An optional 'hide the data' parameter hid the answer",
    observed:
      "In all three trials the model called search_nodes with observationLimit: 0. It found Dana Reyes as the project lead, but the entity's observations - including 'Ships in December' - were omitted, so it reported that no ship date exists.",
    lesson:
      "Optional parameters that silently drop data invite small models to suppress what they need. Prefer safe defaults, and say in the description when a field is omitted.",
  },
  {
    server: "filesystem",
    task: "top-region",
    score: "0/3 with tools",
    title: "Guessing a filename instead of looking",
    observed:
      "Asked about 'the Q3 revenue report', the model invented Q3_revenue_report.txt, tried to read it, searched for its own guess and gave up. It never called list_directory or directory_tree, although reports/q3.csv was one listing away.",
    lesson:
      "Agents need a nudge toward discovery. A description that says 'list the directory first when you do not know the exact path' is cheap to test - and this benchmark is how you would measure it.",
  },
  {
    server: "filesystem",
    task: "append-todo",
    score: "1/3 with tools",
    title: "Writing to paths that do not exist",
    observed:
      "One trial appended to an invented notes/todo.md; another used a made-up /project/... path that the server correctly refused. The passing trial first overwrote the whole file and then rebuilt it - correct in the end, destructive along the way.",
    lesson:
      "Outcome checks catch what transcripts hide: in the todo.md trial the agent confidently reported success. Destructive tools (write_file) next to safe ones (append_file) are a design risk for weaker models.",
  },
];
