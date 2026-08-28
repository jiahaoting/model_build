# 检查 Eastman+Theater.blend 结构（只读，不导出）
import bpy, json

bpy.ops.wm.open_mainfile(filepath=r"C:\Users\jiaha\Downloads\Eastman+Theater.blend")

rep = {
    "unit_scale": bpy.context.scene.unit_settings.scale_length,
    "objects_total": len(bpy.data.objects),
    "meshes_total": len(bpy.data.meshes),
    "materials_total": len(bpy.data.materials),
    "images": [],
    "lights": [],
    "cameras": [],
    "top_objects": [],
}

for img in bpy.data.images:
    rep["images"].append({"name": img.name, "filepath": img.filepath[:120], "size": list(img.size), "packed": bool(img.packed_file)})

for ob in bpy.data.objects:
    if ob.type == 'LIGHT':
        rep["lights"].append({"name": ob.name, "type": ob.data.type, "energy": round(ob.data.energy, 1)})
    elif ob.type == 'CAMERA':
        rep["cameras"].append(ob.name)

# 仅统计顶层（无父级）对象与大体量网格
polys_total = 0
for ob in bpy.data.objects:
    if ob.parent is None:
        e = {"name": ob.name, "type": ob.type, "dim": [round(v, 2) for v in ob.dimensions], "loc": [round(v, 2) for v in ob.location]}
        if ob.type == 'MESH':
            e["verts"] = len(ob.data.vertices)
            e["polys"] = len(ob.data.polygons)
            e["materials"] = [m.name if m else None for m in ob.data.materials][:8]
            polys_total += len(ob.data.polygons)
        rep["top_objects"].append(e)
rep["polys_total_toplevel"] = polys_total

# 全部网格（含子级）多边形统计 + 最大的 20 个网格
allm = []
tp = 0
for ob in bpy.data.objects:
    if ob.type == 'MESH':
        tp += len(ob.data.polygons)
        allm.append((len(ob.data.polygons), ob.name, [round(v, 2) for v in ob.dimensions], [m.name if m else None for m in ob.data.materials][:4]))
rep["polys_total_all"] = tp
allm.sort(reverse=True)
rep["largest_meshes"] = [{"polys": p, "name": n, "dim": d, "mats": m} for p, n, d, m in allm[:20]]

with open(r"c:\Users\jiaha\Documents\trae_projects\model_build\_theater_report.json", "w", encoding="utf-8") as f:
    json.dump(rep, f, ensure_ascii=False, indent=1)
print("THEATER REPORT DONE: objects=", rep["objects_total"], "polys_all=", tp, "images=", len(rep["images"]))
