import { type DesignNode, isContainer, type Project } from "@appshape/ir";
import { useEditor } from "../store";
import { fetchBoardCss } from "./api";

/**
 * Classes the design keeps as they are (typed in "Classes", or imported without a design
 * equivalent) get their CSS from the server's Tailwind, so the board shows them as the app will.
 */
function unmappedClasses(project: Project): string[] {
  const out = new Set<string>();
  const visit = (node: DesignNode) => {
    for (const c of node.platformRaw?.unmapped ?? []) out.add(c);
    if (isContainer(node)) node.children.forEach(visit);
  };
  for (const frame of project.frames) visit(frame.current);
  return [...out].sort();
}

let lastKey = "";
let timer: ReturnType<typeof setTimeout> | undefined;

/** Keeps `boardCss` in the store up to date with the project's classes and tokens. */
export function watchBoardCss(): () => void {
  const update = () => {
    const { project, token } = useEditor.getState();
    if (!project || !token) return;
    const classes = unmappedClasses(project);
    const key = JSON.stringify([classes, project.tokens]);
    if (key === lastKey) return;
    lastKey = key;
    clearTimeout(timer);
    if (classes.length === 0) {
      useEditor.setState({ boardCss: "" });
      return;
    }
    timer = setTimeout(() => {
      fetchBoardCss(token, classes)
        .then((css) => {
          if (key === lastKey) useEditor.setState({ boardCss: css });
        })
        .catch(() => {
          // no CSS: the classes show once the app has them
        });
    }, 150);
  };
  update();
  return useEditor.subscribe((state, previous) => {
    if (state.project !== previous.project || state.token !== previous.token) update();
  });
}
