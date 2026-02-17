import { useEffect, useState } from "react";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker?url";

import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

/* ---------------- Sortable Page ---------------- */
function SortablePage({ page, onToggle }) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition
  } = useSortable({ id: page.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative flex flex-col items-center p-1  rounded
        ${page.deleted ? "opacity-40 grayscale bg-red-50" : "bg-white"}
      `}
    >
      {/* DRAG ACTIVATOR (only this starts drag) */}
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="cursor-grab"
      >
        <img
          src={page.img}
          className="w-[80px] h-[120px] border border-dashed border-blue-500  rounded bg-white"
          draggable={false}
        />
      </div>

      {/* CLICKABLE DELETE BUTTON */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onToggle(page.pageNo)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onToggle(page.pageNo)}
        aria-label={page.deleted ? "Restore page" : "Delete page"}
        title={page.deleted ? "Restore page" : "Delete page"}
        className={`absolute -top-1 -right-1 w-6 h-6 flex items-center justify-center rounded-full text-white text-xs font-semibold shadow-md cursor-pointer select-none transition-all duration-150 ease-out hover:scale-110 hover:shadow-lg active:scale-95 focus:outline-none focus:ring-2 focus:ring-offset-1 ${page.deleted ? "bg-green-600 hover:bg-green-700 focus:ring-green-400" : "bg-red-600 hover:bg-red-700 focus:ring-red-400"}`}
      >
        {page.deleted ? "↺" : "✕"}
      </div>

      <span className="text-[10px] mt-1">
        Page {page.pageNo}
      </span>
    </div>
  );
}

/* ---------------- MAIN ---------------- */
export default function PdfPageOrganizerFinal() {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState({});
  const [deleteInput, setDeleteInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [drag, setDrag] = useState(false);

  /* ---------- Upload ---------- */
  const handleFiles = (list) => {
    const pdfs = Array.from(list).filter(
      (f) => f.type === "application/pdf"
    );
    setFiles(pdfs);
  };

  /* ---------- Generate previews ---------- */
  useEffect(() => {
    let cancelled = false;
    console.log(files)

    const generate = async () => {
      const init = {};
      files.forEach((f) => (init[f.name] = { pages: [] }));
      setPreviews(init);

      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;

          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 0.15 });

          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          canvas.width = viewport.width;
          canvas.height = viewport.height;

          await page.render({ canvasContext: ctx, viewport }).promise;
          const blob = await new Promise((r) => canvas.toBlob(r));
          const url = URL.createObjectURL(blob);

          setPreviews((prev) => ({
            ...prev,
            [file.name]: {
              pages: [
                ...prev[file.name].pages,
                {
                  id: `${file.name}-page-${i}`,
                  img: url,
                  pageNo: i,
                  deleted: false
                }
              ]
            }
          }));

          await new Promise((r) => requestAnimationFrame(r));
        }
      }
    };

    files.length ? generate() : setPreviews({});
    return () => (cancelled = true);
  }, [files]);

  /* ---------- Toggle delete ---------- */
  const toggleDelete = (file, pageNo) => {
    setPreviews((prev) => ({
      ...prev,
      [file]: {
        pages: prev[file].pages.map((p) =>
          p.pageNo === pageNo
            ? { ...p, deleted: !p.deleted }
            : p
        )
      }
    }));
  };

  /* ---------- Bulk delete (add-only) ---------- */
  const applyBulkDeleteAll = () => {
    if (!deleteInput.trim()) return;

    const ranges = deleteInput.split(",");
    const toDelete = new Set();

    ranges.forEach((r) => {
      if (r.includes("-")) {
        const [s, e] = r.split("-").map(Number);
        for (let i = s; i <= e; i++) toDelete.add(i);
      } else {
        toDelete.add(Number(r));
      }
    });

    setPreviews((prev) => {
      const updated = {};
      for (const file in prev) {
        updated[file] = {
          pages: prev[file].pages.map((p) => ({
            ...p,
            deleted: p.deleted || toDelete.has(p.pageNo)
          }))
        };
      }
      return updated;
    });
  };

  /* ---------- Drag reorder ---------- */
  const onDragEnd = (file, event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setPreviews((prev) => {
      const pages = prev[file].pages;
      const oldIndex = pages.findIndex((p) => p.id === active.id);
      const newIndex = pages.findIndex((p) => p.id === over.id);

      return {
        ...prev,
        [file]: {
          pages: arrayMove(pages, oldIndex, newIndex)
        }
      };
    });
  };

  /* ---------- Export ---------- */
  const processPDFs = async () => {
    setLoading(true);
    const zip = new JSZip();

    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(bytes);
      const newDoc = await PDFDocument.create();

      for (const p of previews[file.name].pages) {
        if (p.deleted) continue;
        const [copied] = await newDoc.copyPages(pdfDoc, [p.pageNo - 1]);
        newDoc.addPage(copied);
      }

      zip.file(`modified-${file.name}`, await newDoc.save());
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);

    Object.assign(document.createElement("a"), {
      href: url,
      download: "processed-pdfs.zip"
    }).click();

    setLoading(false);
  };

  const handleReset = () => {
    setFiles([]);
    setPreviews({});
    setDeleteInput("");
    setDrag(false);
  };

  /* ---------- UI ---------- */
  return (
    <div className="min-h-screen bg-slate-300 rounded-xl p-3 grid grid-cols-4 gap-6">

      {/* LEFT */}
      <div className="col-span-3 bg-white p-4 rounded-xl shadow overflow-y-auto">
        {files.length < 1 && <div className=" text-2xl text-slate-600">
          Select Pdfs file to see Preview
        </div>}
        {files.map((file, ind) => (
          <div key={file.name} className="mb-6 border border-gray-400 rounded-2xl p-2 border-dashed min-h-50">
            <p className="font-medium text-start mb-2">{ind + 1}. {file.name} -  <span className=" text-slate-500">{(file.size / 1024).toFixed(1)} KB</span> </p>

            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={(e) => onDragEnd(file.name, e)}
            >
              <SortableContext
                items={previews[file.name]?.pages.map((p) => p.id) || []}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-wrap gap-3">
              
                  {previews[file.name]?.pages.map((p) => (
                    <SortablePage
                      key={p.id}
                      page={p}
                      onToggle={(pg) =>
                        toggleDelete(file.name, pg)
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        ))}
      </div>

      {/* RIGHT */}
      <div className="col-span-1 bg-white p-4 rounded-xl shadow space-y-4">
        {files.length < 1 &&
          <div
            className={`border-2 h-40 rounded-2xl font-semibold border-dashed p-2 flex justify-center items-center flex-col cursor-pointer ${drag ? "bg-blue-50 border-blue-500" : "border-blue-400"
              }`}
            onClick={() => document.getElementById("fileInput").click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              handleFiles(e.dataTransfer.files);
            }}
          >
            Drag & Drop PDFs<br />
            <span className="text-blue-600 ">or click to upload</span>

            <input
              id="fileInput"
              type="file"
              multiple
              accept="application/pdf"
              hidden
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        }

        {files.length > 0 &&
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600">
                Delete pages
              </label>

              <div className="relative">
                <input
                  placeholder="e.g. 1,3,5-7"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition"
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  onBlur={applyBulkDeleteAll}
                />

                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                  pages
                </span>
              </div>
            </div>

            <button
              onClick={processPDFs}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded"
            >
              {loading ? "Processing..." : `Download ZIP${files.length ? ` (${files.length})` : ""}`}
            </button>

            <button
              onClick={handleReset}
              className="w-full border border-red-500 text-red-600 hover:bg-red-50 py-2 rounded transition"
            >
              Clear
            </button>
          </>
        }

      </div>
    </div>
  );
}
