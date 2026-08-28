import bpy
import os

OUT = r"C:\Users\jiaha\Documents\trae_projects\model_build\assets\models\megumin.glb"
TEX_DIR = r"C:\Users\jiaha\Downloads\Megumin+(v3.2)\Textures"

# 材质 → 本地基础色纹理文件名：供把 Toon 节点重建为可导出的 Principled BSDF
BASE_TEX = {
    'Body': 'Megumin_Body_BASE.tga',
    'Eyes': 'Megumin_EYES.tga',
    'Clothes Defalt': 'Megumin_Defalt_BASE.tga',
    'Blush': 'Megumin_BLUSH.tga',
}

def load_local_tex(filename):
    p = os.path.join(TEX_DIR, filename)
    if not os.path.exists(p):
        return None
    # 复用同名已加载 image，否则加载本地文件
    img = bpy.data.images.get(filename)
    if img is None:
        img = bpy.data.images.load(p)
    else:
        img.filepath = p
        img.reload()
    return img

def rebuild_material(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); out.location = (400, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location = (200, 0)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    fname = BASE_TEX.get(mat.name)
    alpha = False
    if fname:
        img = load_local_tex(fname)
        if img:
            tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.location = (-200, 0)
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
            if img.channels == 4:
                nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
                alpha = True
    if not fname:
        bsdf.inputs['Base Color'].default_value = (0.05, 0.05, 0.05, 1.0)

    if alpha:
        mat.blend_method = 'HASHED'
    return mat

print("== 重建材质 ==")
for name in list(bpy.data.materials.keys()):
    rebuild_material(bpy.data.materials[name])

rig = bpy.data.objects.get('rig')
EXCLUDE = {'Staff', 'Head_Normals_Duplicate', 'Hair_Normals', 'Shape Keys Layout'}

bpy.ops.object.select_all(action='DESELECT')
if rig:
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig

export_objs = []
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    if o.name.startswith('WGT-'):
        continue
    if o.name in EXCLUDE:
        continue
    if o.name.upper().startswith('HAIR_NORMALS') or o.name.upper().startswith('HEAD_NORMALS'):
        continue
    bound = any(m.type == 'ARMATURE' and m.object and m.object.name == 'rig' for m in o.modifiers)
    if not bound:
        continue
    o.select_set(True)
    export_objs.append(o)

print(f"导出对象数 = {len(export_objs)+1}")
for o in export_objs:
    print("  " + o.name)

bpy.context.scene.frame_set(0)

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_skins=True,
    export_def_bones=False,
    export_apply=True,
    export_morph=False,
    export_materials='EXPORT',
    export_image_format='WEBP',
    export_yup=True,
    export_animations=False,
    export_texcoords=True,
    export_normals=True,
)
print("== DONE ==")
print("EXISTS", os.path.exists(OUT), "SIZE", os.path.getsize(OUT) if os.path.exists(OUT) else 0)