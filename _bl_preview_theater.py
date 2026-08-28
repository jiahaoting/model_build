# 室内机位渲染（Workbench）：定位舞台与观众席
import bpy, os
from mathutils import Vector

CKPT = r"c:\Users\jiaha\Documents\trae_projects\model_build\_theater_decimated.blend"
PREV = r"c:\Users\jiaha\Documents\trae_projects\model_build"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.edit.use_global_undo = False
bpy.ops.wm.open_mainfile(filepath=CKPT)
sc = bpy.context.scene

sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'MATERIAL'
sc.render.resolution_x = 1100; sc.render.resolution_y = 750

cam_data = bpy.data.cameras.new("_c"); cam = bpy.data.objects.new("_c", cam_data)
sc.collection.objects.link(cam); sc.camera = cam
cam_data.clip_start = 0.1; cam_data.clip_end = 300

# 室内机位（blender 坐标：Z 上，Y 纵深，X 宽；大厅中心约 x=2.9）
views = {
    # 站在厅中部向 -Y 看（猜舞台在 -Y）
    "toNegY": (Vector((2.9, 8, 7)),  Vector((2.9, -20, 2))),
    # 站在 -Y 端向 +Y 看（回看观众席）
    "toPosY": (Vector((2.9, -14, 7)), Vector((2.9, 18, 2))),
    # 低视角贴地：站在 y=8 地面看 -Y
    "floor":  (Vector((2.9, 8, 1.8)), Vector((2.9, -20, 1))),
    # 横厅视角：从 -X 侧看 +X
    "toPosX": (Vector((-12, 0, 7)), Vector((20, 0, 4))),
}
for name, (pos, tgt) in views.items():
    cam.location = pos
    d = tgt - pos
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(PREV, f"_thin_{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"[prev] rendered {name}", flush=True)
print("PREVIEW DONE", flush=True)
