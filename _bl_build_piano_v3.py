# SteinwayGrand.fbx -> steinway_piano.glb（v3：88 键保持独立对象，按半音阶命名）
# 实测事实（_bl_key_bbox.py）：
#   白键 x52: 宽X 0.0214 / 长Y 0.184 / 厚Z 0.037，键床 z 0.651~0.688，前排 y=-0.941
#   黑键 x36: 长Y 0.111，z 0.680~0.699
#   整体: x[-0.706,0.658] y[-0.968,0.743] z[0,1.734] → 键前朝 -Y，上 +Z
# 定向: 绕 Z 转 +90° → 键前 +X、琴长沿 X、上 +Z（glTF: 长X/宽Z/高Y）
# 键序: 演奏者位于 -Y 望向 +Y 时左手为 -X（低音侧），故按 pre-rot X 升序 = 半音阶升序
#       Key_021(A0) ... Key_108(C8)。导出后 three.js 中低音在 +Z、高音在 -Z。
import bpy, json, math, os
from mathutils import Vector

TEX_DIR = r"c:\Users\jiaha\Documents\trae_projects\model_build\assets\models\steinway\textures"
OUT_GLB = r"c:\Users\jiaha\Documents\trae_projects\model_build\assets\models\steinway_piano.glb"
REPORT  = r"c:\Users\jiaha\Documents\trae_projects\model_build\_piano_build_report.json"
PREV    = r"c:\Users\jiaha\Documents\trae_projects\model_build"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=r"C:\Users\jiaha\Downloads\SteinwayGrand.fbx")

log = {"steps": [], "keys": []}
def say(msg):
    log["steps"].append(str(msg))
    print("[build]", msg, flush=True)

# —— 1. 按材质拆分 ——
src = [o for o in bpy.data.objects if o.type == 'MESH'][0]
bpy.ops.object.select_all(action='DESELECT')
src.select_set(True)
bpy.context.view_layer.objects.active = src
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='MATERIAL')
bpy.ops.object.mode_set(mode='OBJECT')

key_islands, body_islands = [], []
WHITE_SIG = (0.021, 0.036, 0.184)
BLACK_SIG = (0.010, 0.019, 0.111)

def sig_match(dims, sig, tol=0.004):
    d = sorted(dims)
    s = sorted(sig)
    return all(abs(a - b) < tol for a, b in zip(d, s))

def is_white(dims):
    d = sorted(dims)
    return all(abs(a - b) < 0.004 for a, b in zip(d, sorted(WHITE_SIG)))

# —— 2. 仅 Steinway_1003 含琴键；逐部件松散拆分并精确签名匹配 ——
for ob in [o for o in bpy.data.objects if o.type == 'MESH']:
    mname = ob.data.materials[0].name if ob.data.materials else 'none'
    if mname != 'Steinway_1003':
        body_islands.append(ob)
        continue
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')
    for isl in [o for o in bpy.context.selected_objects if o.type == 'MESH']:
        d = list(isl.dimensions)
        if sig_match(d, WHITE_SIG) or sig_match(d, BLACK_SIG):
            key_islands.append(isl)
        else:
            body_islands.append(isl)

say(f"keys={len(key_islands)} (expect 88), body parts={len(body_islands)}")
assert len(key_islands) == 88, f"key count mismatch: {len(key_islands)}"

# —— 3. 琴键：按 pre-rot X 升序命名 Key_021..Key_108（低音 -X → 高音 +X） ——
def key_cx(ob):
    xs = [(ob.matrix_world @ Vector(c)).x for c in ob.bound_box]
    return sum(xs) / len(xs)

key_islands.sort(key=key_cx)
WHITE_SEMIS = {0, 2, 4, 5, 7, 9, 11}
for i, ob in enumerate(key_islands):
    midi = 21 + i
    w = (midi % 12) in WHITE_SEMIS
    # 交叉验证：排序推出的黑白与几何签名必须一致
    geo_white = is_white(list(ob.dimensions))
    assert w == geo_white, f"key order mismatch at midi {midi}: chroma says {'W' if w else 'B'} but geometry says {'W' if geo_white else 'B'}"
    ob.name = f"Key_{midi:03d}_{'W' if w else 'B'}"
    log["keys"].append({"midi": midi, "name": ob.name, "cx": round(key_cx(ob), 4)})
say("keys named Key_021..Key_108 with W/B cross-check passed")

# —— 4. 琴体合并（琴键保持独立） ——
bpy.ops.object.select_all(action='DESELECT')
for o in body_islands:
    o.select_set(True)
bpy.context.view_layer.objects.active = body_islands[0]
bpy.ops.object.join()
body_islands[0].name = "SteinwayBody"
body_obj = body_islands[0]

# —— 5. 定向：绕 Z +90°（-Y 前方 → +X） ——
for ob in [body_obj] + key_islands:
    ob.rotation_euler[2] = math.radians(90)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# 验证：键群世界 bbox 前端应在 +X；键序方向复核（低音 Key_021 应在 -Y 侧）
kb = []
for ob in key_islands:
    kb += [ob.matrix_world @ Vector(c) for c in ob.bound_box]
kx = [v.x for v in kb]; kz = [v.z for v in kb]
say(f"post-rot keys bbox x[{min(kx):.3f},{max(kx):.3f}] z[{min(kz):.3f},{max(kz):.3f}]")
assert max(kx) > 0.8, "keys front not at +X?"
y021 = sum((key_islands[0].matrix_world @ Vector(c)).y for c in key_islands[0].bound_box) / 8
y108 = sum((key_islands[-1].matrix_world @ Vector(c)).y for c in key_islands[-1].bound_box) / 8
say(f"Key_021 center y={y021:.3f} (bass, expect <0), Key_108 center y={y108:.3f} (treble, expect >0)")
log["bass_y"] = round(y021, 4); log["treble_y"] = round(y108, 4)

# —— 5b. 琴键原点归于包围盒中心（three.js getWorldPosition 直接得键中心，供指尖 IK 定位） ——
for ob in key_islands:
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
say("key origins set to bounds center")

# —— 6. 材质接贴图 ——
def load_img(fname, non_color=False):
    p = os.path.join(TEX_DIR, fname)
    if not os.path.exists(p):
        say(f"WARN missing texture {fname}")
        return None
    img = bpy.data.images.load(p, check_existing=True)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    return img

def build_mat(mat, base, metallic=None, rough=None, normal=None, opacity=None):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); out.location = (600, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location = (250, 0)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    if base:
        n = nt.nodes.new('ShaderNodeTexImage'); n.location = (-500, 300); n.image = load_img(base)
        nt.links.new(n.outputs['Color'], bsdf.inputs['Base Color'])
    if metallic:
        n = nt.nodes.new('ShaderNodeTexImage'); n.location = (-500, 60); n.image = load_img(metallic, True)
        nt.links.new(n.outputs['Color'], bsdf.inputs['Metallic'])
    if rough:
        n = nt.nodes.new('ShaderNodeTexImage'); n.location = (-500, -140); n.image = load_img(rough, True)
        nt.links.new(n.outputs['Color'], bsdf.inputs['Roughness'])
    if normal:
        n = nt.nodes.new('ShaderNodeTexImage'); n.location = (-500, -420); n.image = load_img(normal, True)
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.location = (-200, -420)
        nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if opacity:
        n = nt.nodes.new('ShaderNodeTexImage'); n.location = (-500, 560); n.image = load_img(opacity, True)
        nt.links.new(n.outputs['Color'], bsdf.inputs['Alpha'])
        mat.blend_method = 'CLIP'
        mat.alpha_threshold = 0.5

MAT_TEX = {
    'Steinway_1001': ('SteinwayPiano_udim1_BaseColor.png', 'SteinwayPiano_udim1_Metallic.png', 'SteinwayPiano_udim1_Roughness.png', 'SteinwayPiano_udim1_Normal.png', None),
    'Steinway_1002': ('SteinwayPiano_udim2_BaseColor.png', 'SteinwayPiano_udim2_Metallic.png', 'SteinwayPiano_udim2_Roughness.png', 'SteinwayPiano_udim2_Normal.png', None),
    'Steinway_1003': ('SteinwayPiano_udim3_BaseColor.png', 'SteinwayPiano_udim3_Metallic.png', 'SteinwayPiano_udim3_Roughness.png', 'SteinwayPiano_udim3_Normal.png', None),
    'Steinway_1004': ('SteinwayPiano_udim4_BaseColor.png', 'SteinwayPiano_udim4_Metallic.png', 'SteinwayPiano_udim4_Roughness.png', 'SteinwayPiano_udim4_Normal.png', 'SteinwayPianoUDIM4Steinwayopacity.png'),
    'phong1': ('SteinwayPiano_tuningpin_BaseColor.png', 'SteinwayPiano_tuningpin_Metallic.png', 'SteinwayPiano_tuningpin_Roughness.png', None, None),
}
for mat in bpy.data.materials:
    tex = MAT_TEX.get(mat.name)
    if tex:
        build_mat(mat, *tex)
        say(f"material wired: {mat.name}")

# —— 7. 贴图 2048 降采样并打包 ——
for img in bpy.data.images:
    if img.size[0] > 2048:
        img.scale(2048, 2048)
    img.pack()

# —— 8. 先导出（关键路径优先，避免渲染崩溃丢失产物） ——
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format='GLB',
    export_yup=True, export_apply=True,
    export_animations=False, export_skins=False, export_morph=False
)
say(f"exported {OUT_GLB} sizeMB={os.path.getsize(OUT_GLB)/1e6:.1f}")

with open(REPORT, "w", encoding="utf-8") as f:
    json.dump(log, f, ensure_ascii=False, indent=1)

# —— 9. 预览渲染（Workbench 实色，轻量；失败不影响产物） ——
sc = bpy.context.scene
try:
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x = 1100; sc.render.resolution_y = 850
    cam_data = bpy.data.cameras.new("_cam"); cam = bpy.data.objects.new("_cam", cam_data)
    sc.collection.objects.link(cam); sc.camera = cam
    views = {
        "top":  (Vector((0, 0, 6)),  Vector((0, 0, 0))),
        "keys": (Vector((3.2, 0, 1.6)), Vector((0.9, 0, 0.65))),
        "persp": (Vector((2.6, -2.4, 2.0)), Vector((0, 0, 0.6))),
    }
    for name, (pos, tgt) in views.items():
        cam.location = pos
        d = tgt - pos
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREV, f"_steinway_{name}.png")
        bpy.ops.render.render(write_still=True)
        say(f"rendered {name}")
except Exception as e:
    say(f"render skipped: {e}")

print("BUILD DONE", flush=True)
