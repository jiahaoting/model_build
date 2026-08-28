# 检查 SteinwayGrand.fbx 结构：对象/材质/UDIM 分布
import bpy, json, sys

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=r"C:\Users\jiaha\Downloads\SteinwayGrand.fbx")

report = {"objects": [], "images": [], "materials": []}

for ob in bpy.data.objects:
    entry = {
        "name": ob.name, "type": ob.type,
        "loc": [round(v, 3) for v in ob.location],
        "dim": [round(v, 3) for v in ob.dimensions],
    }
    if ob.type == 'MESH':
        entry["verts"] = len(ob.data.vertices)
        entry["polys"] = len(ob.data.polygons)
        entry["materials"] = [m.name if m else None for m in ob.data.materials]
        # UV 范围（判断 UDIM 象限）
        if ob.data.uv_layers:
            uv = ob.data.uv_layers.active.data
            us = [l.uv[0] for l in uv]; vs = [l.uv[1] for l in uv]
            if us:
                entry["uv_u_range"] = [round(min(us), 2), round(max(us), 2)]
                entry["uv_v_range"] = [round(min(vs), 2), round(max(vs), 2)]
    report["objects"].append(entry)

for img in bpy.data.images:
    report["images"].append({"name": img.name, "filepath": img.filepath, "size": list(img.size)})

for mat in bpy.data.materials:
    nodes = []
    if mat.use_nodes:
        for n in mat.node_tree.nodes:
            if n.type == 'TEX_IMAGE':
                nodes.append({"image": n.image.name if n.image else None,
                              "tiles": getattr(n, "tiles", None) and len(getattr(n, "tiles", [])) or None})
    report["materials"].append({"name": mat.name, "tex_nodes": nodes})

with open(r"c:\Users\jiaha\Documents\trae_projects\model_build\_piano_report.json", "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=1)
print("REPORT DONE, objects:", len(report["objects"]), "materials:", len(report["materials"]))
