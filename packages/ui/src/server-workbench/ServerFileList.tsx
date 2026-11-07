import { useEffect, useState } from "react";
import { Folder, File, RefreshCw } from "lucide-react";
import type { ServerFile } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import type { ServerWorkbenchController } from "./useServerWorkbench.js";
import { useServerText } from "./text.js";
export const formatSize = (n: number) =>
  n > 1048576
    ? `${(n / 1048576).toFixed(1)} MB`
    : n > 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${n} B`;
export const childPath = (parent: string, name: string) =>
  `${parent.replace(/[\\/]+$/, "")}/${name}`;
export function FileList({
  label,
  serverId,
  controller: c,
  onSelect,
  path,
  setPath,
  selected,
  hidden,
  refreshToken,
}: {
  label: string;
  serverId?: string;
  controller: ServerWorkbenchController;
  onSelect: (files: ServerFile[]) => void;
  path: string;
  setPath: (p: string) => void;
  selected: ServerFile[];
  hidden: boolean;
  refreshToken: number;
}) {
  const t = useServerText(),
    [files, setFiles] = useState<ServerFile[]>([]),
    [address, setAddress] = useState(path),
    [truncated, setTruncated] = useState(false);
  const [sort, setSort] = useState<"name" | "size" | "modified">("name"),
    [descending, setDescending] = useState(false);
  const changeSort = (field: typeof sort) => {
    if (field === sort) setDescending((v) => !v);
    else {
      setSort(field);
      setDescending(false);
    }
  };
  useEffect(() => {
    setAddress(path);
  }, [path]);
  useEffect(() => {
    let current = true;
    onSelect([]);
    void c
      .request({ op: "files", serverId, path })
      .then((r) => {
        if (current) {
          setFiles(r.files ?? []);
          setTruncated(Boolean(r.truncated));
          if (!path && r.path) setPath(r.path);
        }
      })
      .catch(() => {
        if (current) setFiles([]);
      });
    return () => {
      current = false;
    };
  }, [serverId, path, c.request, refreshToken]);
  const entries = files
    .filter((f) => hidden || !f.name.startsWith("."))
    .sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        (descending ? -1 : 1) *
          (sort === "name" ? a.name.localeCompare(b.name) : a[sort] - b[sort]),
    );
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border-subtle p-2 text-ui-caption">
        <strong>{label}</strong>
        <form
          className="flex min-w-0 flex-1 gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            setPath(address);
          }}
        >
          <Input
            aria-label={`${label} ${t.path}`}
            className="h-7"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            type="submit"
            aria-label={t.refresh}
          >
            <RefreshCw className="size-3" />
          </Button>
        </form>
        <Button size="sm" variant="ghost" onClick={() => setPath(childPath(path, ".."))}>
          {t.up}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-ui-caption">
          <thead className="sticky top-0 bg-background text-muted-foreground">
            <tr>
              <th className="w-8" />
              <th className="px-2 py-1">
                <button onClick={() => changeSort("name")}>{t.name}</button>
              </th>
              <th>
                <button onClick={() => changeSort("size")}>{t.size}</button>
              </th>
              <th className="hidden xl:table-cell">
                <button onClick={() => changeSort("modified")}>{t.modified}</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((f) => (
              <tr
                key={f.path}
                className="cursor-default hover:bg-surface-hover"
                onDoubleClick={() => {
                  if (f.directory) setPath(f.path);
                }}
              >
                <td className="px-2">
                  <input
                    aria-label={f.name}
                    type="checkbox"
                    checked={selected.some((s) => s.path === f.path)}
                    onChange={(e) =>
                      onSelect(
                        e.target.checked
                          ? [...selected, f]
                          : selected.filter((s) => s.path !== f.path),
                      )
                    }
                  />
                </td>
                <td className="max-w-0 truncate px-2 py-1.5" title={f.name}>
                  {f.directory ? (
                    <Folder className="mr-1 inline size-3 text-warning" />
                  ) : (
                    <File className="mr-1 inline size-3 text-muted-foreground" />
                  )}
                  {f.name}
                </td>
                <td className="whitespace-nowrap pr-2 text-muted-foreground">
                  {f.directory ? "—" : formatSize(f.size)}
                </td>
                <td className="hidden whitespace-nowrap pr-2 text-muted-foreground xl:table-cell">
                  {f.modified ? new Date(f.modified).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length ? (
          <p className="p-3 text-ui-caption text-muted-foreground">{t.noFiles}</p>
        ) : null}
        {truncated ? <p className="p-2 text-ui-caption text-warning">{t.truncated}</p> : null}
      </div>
    </section>
  );
}
