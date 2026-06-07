import { NoteMdEditorImpl } from "./NoteMdEditorImpl";

type NoteMdEditorProps = {
  markdown: string;
  onChange: (value: string) => void;
  editorKey: string;
};

export function NoteMdEditor(props: NoteMdEditorProps) {
  return <NoteMdEditorImpl {...props} />;
}
