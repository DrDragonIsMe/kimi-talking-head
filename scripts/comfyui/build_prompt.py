#!/usr/bin/env python3
"""Manually build a correct ComfyUI API prompt from workflow_base.json.

The auto-converted workflow_prompt.json has mis-ordered widget values for
several custom nodes. This script extracts the actual intended values from
workflow_base.json and maps them to the correct input names using the node
definitions from ComfyUI object_info.
"""

import json
import sys
import requests


def load_json(path):
    with open(path) as f:
        return json.load(f)


def fetch_object_info(base_url):
    resp = requests.get(f"{base_url}/object_info", timeout=30)
    resp.raise_for_status()
    return resp.json()


def is_link_spec(spec):
    """Return True if spec describes a link input (not a widget)."""
    if not isinstance(spec, list) or len(spec) < 1:
        return False
    first = spec[0]
    # Widget primitive types in ComfyUI
    if isinstance(first, str):
        if first in ("BOOLEAN", "INT", "FLOAT", "STRING"):
            return False
        # Link types are uppercase strings like "WANVIDEOMODEL", "IMAGE", etc.
        if first and first[0].isupper():
            return True
    return False


def build_prompt(workflow, object_info):
    nodes = {node['id']: node for node in workflow['nodes']}
    links = {}
    for link in workflow.get('links', []):
        link_id, src_id, src_slot, dst_id, dst_slot, link_type = link
        links[link_id] = {
            'src_id': src_id,
            'src_slot': src_slot,
            'dst_id': dst_id,
            'dst_slot': dst_slot,
            'type': link_type
        }

    prompt = {}
    for node_id, node in nodes.items():
        class_type = node['type']
        node_info = object_info.get(class_type, {})
        input_def = node_info.get('input', {})
        required_names = input_def.get('input_order', {}).get('required', list(input_def.get('required', {}).keys()))
        optional_names = input_def.get('input_order', {}).get('optional', list(input_def.get('optional', {}).keys()))

        # Specs
        required_specs = input_def.get('required', {})
        optional_specs = input_def.get('optional', {})

        # Node inputs by name
        node_inputs_by_name = {inp['name']: inp for inp in node.get('inputs', [])}

        widgets = node.get('widgets_values', [])
        if isinstance(widgets, dict):
            widget_values = widgets
        else:
            # Build mapping from widget name to value by matching widget order
            # Widget order = input_order required non-link + input_order optional non-link,
            # interleaved exactly as saved by ComfyUI.  We iterate all input names
            # and consume the flat widgets_values list for each non-link widget input.
            widget_values = {}
            widget_idx = 0
            for name in required_names + optional_names:
                spec = required_specs.get(name) or optional_specs.get(name)
                if spec is None:
                    continue
                inp = node_inputs_by_name.get(name)
                has_link = inp is not None and inp.get('link') is not None
                if has_link:
                    continue
                if is_link_spec(spec):
                    # No link but link-type spec -> skip (no widget value expected)
                    continue
                if widget_idx < len(widgets):
                    widget_values[name] = widgets[widget_idx]
                    widget_idx += 1

        inputs = {}
        for name in required_names + optional_names:
            spec = required_specs.get(name) or optional_specs.get(name)
            if spec is None:
                continue
            inp = node_inputs_by_name.get(name)
            if inp is not None and inp.get('link') is not None:
                link_id = inp['link']
                if link_id in links:
                    link_info = links[link_id]
                    inputs[name] = [str(link_info['src_id']), link_info['src_slot']]
            elif name in widget_values:
                inputs[name] = widget_values[name]

        prompt[str(node_id)] = {
            'inputs': inputs,
            'class_type': class_type,
            '_meta': {
                'title': node.get('title', class_type)
            }
        }

    return prompt


def main():
    if len(sys.argv) < 4:
        print('Usage: python build_prompt.py <comfyui-url> <input-workflow.json> <output-prompt.json>')
        sys.exit(1)

    base_url = sys.argv[1]
    input_path = sys.argv[2]
    output_path = sys.argv[3]

    object_info = fetch_object_info(base_url)
    workflow = load_json(input_path)
    prompt = build_prompt(workflow, object_info)

    with open(output_path, 'w') as f:
        json.dump(prompt, f, indent=2, ensure_ascii=False)

    print(f'Built prompt with {len(prompt)} nodes: {output_path}')


if __name__ == '__main__':
    main()
