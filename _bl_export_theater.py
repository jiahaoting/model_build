# Eastman Theater .blend -> eastman_theater.glb（v5：放弃 Blender 合并）
# 教训：SketchUp 源网格自定义数据层在 Blender 5.2 join 时触发整数溢出崩溃（两次）。
# 策略：数据块级减面 -> 存检查点 -> 直接导出全部对象（glTF 自动去重共享网格），
#       合并改在 three.js 加载时按材质执行（BufferGeometryUtils.mergeGeometries）。
import bpy, json, math, os
from mathutils import Vector

SRC    = r"C:\Users\jiaha\Downloads\Eastman+Theater.blend"
CKPT   = r"c:\Users\jiaha\Documents\trae_projects\model_build\_theater_decimated.blend"
OUT_GLB= r"c:\Users\jiaha\Documents\trae_projects\model_build\assets\models\eastman_theater.glb"
REPORT = r"c:\Users\jiaha\Documents\trae_projects\model_build\_theater_export_report.json"

log = {"steps": [], "lights": []}
def say(m):
    log["steps"].append(str(m)); print("[theater]", m, flush=True)

def dump():
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, indent=1)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.edit.use_global_undo = False

def total_polys():
    return sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')

def scan_bbox():
    mins = Vector((1e18,) * 3); maxs = Vector((-1e18,) * 3)
    for ob in bpy.data.objects:
        if ob.type != 'MESH':
            continue
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            mins = Vector(map(min, mins, w)); maxs = Vector(map(max, maxs, w))
    return mins, maxs

if os.path.exists(CKPT):
    say(f"checkpoint found, resume: {CKPT}")
    bpy.ops.wm.open_mainfile(filepath=CKPT)
    say(f"resumed. objects={len(bpy.data.objects)} polys={total_polys()}")
else:
    say("opening source blend ...")
    bpy.ops.wm.open_mainfile(filepath=SRC)
    sc = bpy.context.scene
    say(f"opened. objects={len(bpy.data.objects)} mesh_datablocks={len(bpy.data.meshes)} images={len(bpy.data.images)}")
    say(f"object polys total={total_polys()}")

    mins, maxs = scan_bbox()
    say(f"bbox min=({mins.x:.2f},{mins.y:.2f},{mins.z:.2f}) max=({maxs.x:.2f},{maxs.y:.2f},{maxs.z:.2f})")
    log["bbox"] = {"min": [round(v, 3) for v in mins], "max": [round(v, 3) for v in maxs]}

    # —— 记录灯光，删除灯光/相机 ——
    for ob in list(bpy.data.objects):
        if ob.type == 'LIGHT':
            d = ob.data; w = ob.matrix_world
            fwd = w.to_quaternion() @ Vector((0, 0, -1))
            log["lights"].append({
                "name": ob.name, "type": d.type, "energy": round(d.energy, 1),
                "pos": [round(v, 2) for v in w.translation],
                "dir": [round(v, 2) for v in fwd],
                "color": [round(c, 3) for c in d.color],
                "spot_size": round(math.degrees(d.spot_size), 1) if d.type == 'SPOT' else None,
            })
    for ob in list(bpy.data.objects):
        if ob.type in ('LIGHT', 'CAMERA'):
            bpy.data.objects.remove(ob, do_unlink=True)
    say(f"lights recorded={len(log['lights'])}")
    dump()

    # —— 网格数据块级减面 ——
    tiers = [(100000, 0.10), (30000, 0.25), (10000, 0.40), (3000, 0.60)]
    coll = bpy.context.scene.collection
    n_dec = 0
    before_unique = sum(len(m.polygons) for m in bpy.data.meshes)
    for mesh in list(bpy.data.meshes):
        p = len(mesh.polygons)
        if p < 3000:
            continue
        ratio = None
        for th, r in tiers:
            if p >= th:
                ratio = r; break
        if ratio is None:
            continue
        tmp = mesh.copy()
        obj = bpy.data.objects.new("_tmp_dec", tmp)
        coll.objects.link(obj)
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new("dec", 'DECIMATE')
        mod.ratio = ratio; mod.use_collapse_triangulate = True
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
            mesh.user_remap(tmp)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
            n_dec += 1
        except Exception as e:
            say(f"decimate fail {mesh.name}: {e}")
            bpy.data.meshes.remove(tmp)
        bpy.data.objects.remove(obj, do_unlink=True)
        if n_dec % 50 == 0:
            say(f"decimated {n_dec} ...")
    after_unique = sum(len(m.polygons) for m in bpy.data.meshes)
    say(f"decimated={n_dec}; unique {before_unique} -> {after_unique}; object total={total_polys()}")

    # —— 贴图降采样并打包（1024 上限） ——
    n_img = 0
    for img in bpy.data.images:
        if img.size[0] == 0:
            continue
        w, h = img.size
        if max(w, h) > 1024:
            s = 1024 / max(w, h)
            img.scale(max(1, int(w * s)), max(1, int(h * s)))
        try:
            img.pack(); n_img += 1
        except Exception as e:
            say(f"pack fail {img.name}: {e}")
    say(f"images packed={n_img}/{len(bpy.data.images)}")

    bpy.ops.wm.save_as_mainfile(filepath=CKPT, check_existing=False)
    say(f"checkpoint saved: {CKPT}")
    dump()

# ================= 直接导出（无合并） =================
sc = bpy.context.scene
mins, maxs = scan_bbox()
log["bbox_final"] = {"min": [round(v, 3) for v in mins], "max": [round(v, 3) for v in maxs]}
say(f"final bbox={log['bbox_final']} objects={len(bpy.data.objects)} polys={total_polys()}")

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
kw = dict(
    filepath=OUT_GLB, export_format='GLB',
    export_yup=True, export_apply=True,
    export_animations=False, export_skins=False, export_morph=False,
    export_cameras=False, export_lights=False,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
)
try:
    bpy.ops.export_scene.gltf(**kw, export_image_format='WEBP', export_image_quality=80)
except TypeError as e:
    say(f"webp export param fail ({e}); fallback AUTO")
    bpy.ops.export_scene.gltf(**kw)
say(f"exported {OUT_GLB} sizeMB={os.path.getsize(OUT_GLB)/1e6:.1f}")

dump()
print("THEATER EXPORT DONE", flush=True)
