# 分析 SteinwayGrand 各材质部件的松散块：尺寸聚类 + 位置分布，定位琴键
import bpy, json
from collections import Counter

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=r"C:\Users\jiaha\Downloads\SteinwayGrand.fbx")

src = [o for o in bpy.data.objects if o.type == 'MESH'][0]
bpy.ops.object.select_all(action='DESELECT')
src.select_set(True)
bpy.context.view_layer.objects.active = src
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='MATERIAL')
bpy.ops.object.mode_set(mode='OBJECT')

parts = [o for o in bpy.data.objects if o.type == 'MESH']
report = {}

for ob in parts:
    mname = ob.data.materials[0].name if ob.data.materials else 'none'
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')
    islands = [o for o in bpy.context.selected_objects if o.type == 'MESH']

    sig_counter = Counter()
    entries = []
    for isl in islands:
        d = isl.dimensions
        key = (round(d.x, 3), round(d.y, 3), round(d.z, 3))
        c = isl.location
        sig_counter[tuple(sorted(key))] += 1
        entries.append({
            "name": isl.name, "dims": [round(v, 4) for v in (d.x, d.y, d.z)],
            "center": [round(v, 4) for v in (c.x, c.y, c.z)],
            "verts": len(isl.data.vertices),
        })
    common = [{"sig": list(k), "count": v} for k, v in sig_counter.most_common(12)]
    report[mname] = {"islands": len(islands), "common_sigs": common, "entries": entries}

with open(r"c:\Users\jiaha\Documents\trae_projects\model_build\_islands_report.json", "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=1)

for m, r in report.items():
    print(f"== {m}: {r['islands']} islands")
    for c in r["common_sigs"][:8]:
        print("   sig", c["sig"], "x", c["count"])
print("ANALYSIS DONE")
