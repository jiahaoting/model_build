# 渲染 SteinwayGrand 三视图预览（判定朝向）
import bpy, math
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=r"C:\Users\jiaha\Downloads\SteinwayGrand.fbx")

# 场景灯光
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", 'SUN'))
sun.data.energy = 4.0
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
bpy.context.scene.collection.objects.link(sun)

cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = 900
sc.render.resolution_y = 700
sc.render.film_transparent = False
sc.world = bpy.data.worlds.new("W")
sc.world.color = (0.15, 0.15, 0.15)

# 模型整体范围
mesh = [o for o in bpy.data.objects if o.type == 'MESH'][0]
pts = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
cx, cy, cz = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2, (min(zs)+max(zs))/2
D = max(max(xs)-min(xs), max(ys)-min(ys), max(zs)-min(zs)) * 1.6

views = {
    "view_pX": Vector((cx + D, cy, cz)),   # 从 +X 看
    "view_pY": Vector((cx, cy + D, cz)),   # 从 +Y 看
    "view_pZ": Vector((cx, cy, cz + D)),   # 从 +Z 俯视
}
for name, pos in views.items():
    cam.location = pos
    direction = Vector((cx, cy, cz)) - pos
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = rf"c:\Users\jiaha\Documents\trae_projects\model_build\_piano_{name}.png"
    bpy.ops.render.render(write_still=True)
    print("rendered", name)
print("PREVIEW DONE")
