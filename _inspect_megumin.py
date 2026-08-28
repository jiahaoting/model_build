import bpy

print("===== Solidify 'Outline' 修改器参数（Body / Hair-A）=====")
for oname in ['Body', 'Hair-A', 'Belt-1']:
    o = bpy.data.objects.get(oname)
    if not o:
        continue
    for m in o.modifiers:
        if m.type == 'SOLIDIFY':
            print(f"\n{oname} / modifier '{m.name}':")
            print(f"  thickness={m.thickness}")
            print(f"  offset={m.offset}")
            print(f"  use_even_offset={m.use_even_offset}")
            print(f"  use_flip_normals={m.use_flip_normals}")
            print(f"  material_offset={m.material_offset}")
            print(f"  material_offset_rim={m.material_offset_rim}")
            print(f"  show_render={m.show_render} show_viewport={m.show_viewport}")
            print(f"  use_rim={m.use_rim}")

print("\n===== Outline 材质的 Emission 颜色 =====")
for mat in bpy.data.materials:
    if mat.name.lower().startswith('outline') or 'dots' in mat.name.lower():
        if not mat.use_nodes:
            print(f"{mat.name}: diffuse={tuple(round(c,3) for c in mat.diffuse_color)}")
            continue
        for node in mat.node_tree.nodes:
            if node.type == 'EMISSION':
                print(f"{mat.name}: Emission color={tuple(round(c,3) for c in node.inputs['Color'].default_value)} strength={node.inputs['Strength'].default_value}")