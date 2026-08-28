# 打印 52/36 键岛群与整体网格的世界包围盒（min/max per axis）
import bpy, json
from mathutils import Vector

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

part1003 = None
for ob in bpy.data.objects:
    if ob.type == 'MESH' and ob.data.materials and ob.data.materials[0].name == 'Steinway_1003':
        part1003 = ob
bpy.ops.object.select_all(action='DESELECT')
part1003.select_set(True)
bpy.context.view_layer.objects.active = part1003
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='LOOSE')
bpy.ops.object.mode_set(mode='OBJECT')

def wbbox(ob):
    pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))

w52 = []; b36 = []
for ob in bpy.context.selected_objects:
    if ob.type != 'MESH':
        continue
    d = sorted([round(v, 3) for v in ob.dimensions])
    if abs(d[0]-0.021) < 0.003 and abs(d[1]-0.036) < 0.003 and abs(d[2]-0.184) < 0.004:
        w52.append(ob)
    elif abs(d[0]-0.010) < 0.003 and abs(d[1]-0.019) < 0.003 and abs(d[2]-0.111) < 0.004:
        b36.append(ob)

print("white:", len(w52), "black:", len(b36))
if w52:
    x0 = min(wbbox(o)[0][0] for o in w52); x1 = max(wbbox(o)[0][1] for o in w52)
    y0 = min(wbbox(o)[1][0] for o in w52); y1 = max(wbbox(o)[1][1] for o in w52)
    z0 = min(wbbox(o)[2][0] for o in w52); z1 = max(wbbox(o)[2][1] for o in w52)
    print(f"WHITE group bbox: x[{x0:.3f},{x1:.3f}] y[{y0:.3f},{y1:.3f}] z[{z0:.3f},{z1:.3f}]")
    e = wbbox(w52[0])
    print(f"WHITE[0] bbox: x[{e[0][0]:.3f},{e[0][1]:.3f}] y[{e[1][0]:.3f},{e[1][1]:.3f}] z[{e[2][0]:.3f},{e[2][1]:.3f}]")
if b36:
    x0 = min(wbbox(o)[0][0] for o in b36); x1 = max(wbbox(o)[0][1] for o in b36)
    y0 = min(wbbox(o)[1][0] for o in b36); y1 = max(wbbox(o)[1][1] for o in b36)
    z0 = min(wbbox(o)[2][0] for o in b36); z1 = max(wbbox(o)[2][1] for o in b36)
    print(f"BLACK group bbox: x[{x0:.3f},{x1:.3f}] y[{y0:.3f},{y1:.3f}] z[{z0:.3f},{z1:.3f}]")

mesh_all = [o for o in bpy.data.objects if o.type == 'MESH']
xa0 = min(wbbox(o)[0][0] for o in mesh_all); xa1 = max(wbbox(o)[0][1] for o in mesh_all)
ya0 = min(wbbox(o)[1][0] for o in mesh_all); ya1 = max(wbbox(o)[1][1] for o in mesh_all)
za0 = min(wbbox(o)[2][0] for o in mesh_all); za1 = max(wbbox(o)[2][1] for o in mesh_all)
print(f"ALL bbox: x[{xa0:.3f},{xa1:.3f}] y[{ya0:.3f},{ya1:.3f}] z[{za0:.3f},{za1:.3f}]")
print("BBOX DONE")
