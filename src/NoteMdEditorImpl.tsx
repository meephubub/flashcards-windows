import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  MDXEditor,
  quotePlugin,
  ListsToggle,
  Separator,
  toolbarPlugin,
  UndoRedo,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";

type NoteMdEditorImplProps = {
  markdown: string;
  onChange: (value: string) => void;
  editorKey: string;
};

export function NoteMdEditorImpl({
  markdown,
  onChange,
  editorKey,
}: NoteMdEditorImplProps) {
  return (
    <div className="note-mdx-editor-root">
      <MDXEditor
        key={editorKey}
        markdown={markdown}
        onChange={onChange}
        contentEditableClassName="note-mdx-editable"
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          markdownShortcutPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <>
                <UndoRedo />
                <Separator />
                <BoldItalicUnderlineToggles />
                <Separator />
                <BlockTypeSelect />
                <ListsToggle />
                <Separator />
                <CreateLink />
              </>
            ),
          }),
        ]}
      />
    </div>
  );
}
