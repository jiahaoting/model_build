# 预览导出后的 steinway_piano.glb（EEVEE 带贴图，正面+侧面+顶视）
import bpy, math, sys
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=r"c:\Users\jiaha\Documents\trae_projects\model_build\assets\models\steinway_piano.glb")

sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", 'SUN'))
sun.data.energy = 5.0
sun.rotation_euler = (math.radians(55), 0, math.radians(35))
bpy.context.scene.collection.objects.link(sun)
w = bpy.data.worlds.new("W")
w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.25, 0.25, 0.28, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
bpy.context.scene.world = w

cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x = 960
sc.render.resolution_y = 720

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
pts = []
for m in meshes:
    pts += [m.matrix_world @ Vector(c) for c in m.bound_box]
xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
cx, cy, cz = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2, (min(zs)+max(zs))/2
D = max(max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs)) * 1.7
print(f"GLB bbox: x[{min(xs):.2f},{max(xs):.2f}] y[{min(ys):.2f},{max(ys):.2f}] z[{min(zs):.2f},{max(zs):.2f}]")
print("objects:", [(o.name, o.type) for o in bpy.data.objects][:10])

views = {
    "front":  Vector((cx + D, cy - D * 0.6, cz + D * 0.35)),   # 从 +X 前侧（键盘应在近端）
    "side":   Vector((cx, cy - D, cz + D * 0.4)),
    "top":    Vector((cx, cy, cz + D * 1.2)),
    "keys":   Vector((cx + D * 0.9, cy, cz + D * 0.55)),       # 正对 +X 看键盘
}
for name, pos in views.items():
    cam.location = pos
    d = Vector((cx, cy, cz)) - pos
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = rf"c:\Users\jiaha\Documents\trae_projects\model_build\_steinway_{name}.png"
    bpy.ops.render.render(write_still=True)
    print("rendered", name)
print("DONE")
