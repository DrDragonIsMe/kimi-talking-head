#!/usr/bin/env python3
"""Convert ComfyUI frontend workflow JSON to API prompt format.

Requires ComfyUI object_info to map widget values to parameter names.
"""

import json
import sys
import requests


def fetch_object_info(base_url):
    """Fetch object_info from ComfyUI API."""
    resp = requests.get(f"{base_url}/object_info", timeout=30)
    resp.raise_for_status()
    return resp.json()


def convert_workflow_to_prompt(workflow, object_info):
    """Convert frontend workflow format to API prompt format."""
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
        inputs = {}
        
        # Get node definition from object_info
        node_info = object_info.get(class_type, {})
        input_def = node_info.get('input', {})
        required_names = input_def.get('input_order', {}).get('required', list(input_def.get('required', {}).keys()))
        optional_names = input_def.get('input_order', {}).get('optional', list(input_def.get('optional', {}).keys()))
        all_input_names = required_names + optional_names
        
        # Build input name -> is_link info
        input_specs = {}
        for name in required_names:
            spec = input_def.get('required', {}).get(name)
            if spec is not None:
                input_specs[name] = spec
        for name in optional_names:
            spec = input_def.get('optional', {}).get(name)
            if spec is not None:
                input_specs[name] = spec
        
        # Map node inputs by name
        node_inputs_by_name = {inp['name']: inp for inp in node.get('inputs', [])}
        node_outputs_by_slot = {i: out for i, out in enumerate(node.get('outputs', []))}
        
        # Widgets values
        widgets = node.get('widgets_values', [])
        if isinstance(widgets, dict):
            # Some custom nodes use dict-style widgets
            for name, value in widgets.items():
                inputs[name] = value
        else:
            widget_idx = 0
            for name in all_input_names:
                spec = input_specs.get(name)
                if spec is None:
                    continue
                
                # Check if this input has a link
                inp_def = node_inputs_by_name.get(name)
                if inp_def and inp_def.get('link') is not None:
                    link_id = inp_def['link']
                    if link_id in links:
                        link_info = links[link_id]
                        inputs[name] = [str(link_info['src_id']), link_info['src_slot']]
                    continue
                
                # spec for widget: [[choices], {extra}] or ["BOOLEAN"/"INT"/"FLOAT"/"STRING", {extra}]
                # spec for link: ["TYPE", {extra}] where TYPE is an uppercase custom type
                is_widget = False
                if isinstance(spec, list) and len(spec) >= 1:
                    first = spec[0]
                    if isinstance(first, list):
                        is_widget = True
                    elif isinstance(first, str):
                        if first in ("BOOLEAN", "INT", "FLOAT", "STRING"):
                            is_widget = True
                        # Otherwise uppercase custom types are link inputs
                
                # If this input is not connected and is a link-type spec, skip it
                if not is_widget and isinstance(spec, list) and len(spec) >= 1 and isinstance(spec[0], str) and spec[0] and spec[0][0].isupper():
                    continue
                
                if is_widget:
                    if widget_idx < len(widgets):
                        inputs[name] = widgets[widget_idx]
                        widget_idx += 1
        
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
        print('Usage: python convert_workflow.py <comfyui-url> <input-workflow.json> <output-prompt.json>')
        print('Example: python convert_workflow.py http://localhost:18188 workflow.json prompt.json')
        sys.exit(1)
    
    base_url = sys.argv[1]
    input_path = sys.argv[2]
    output_path = sys.argv[3]
    
    object_info = fetch_object_info(base_url)
    
    with open(input_path) as f:
        workflow = json.load(f)
    
    prompt = convert_workflow_to_prompt(workflow, object_info)
    
    with open(output_path, 'w') as f:
        json.dump(prompt, f, indent=2)
    
    print(f'Converted {len(prompt)} nodes to prompt format: {output_path}')


if __name__ == '__main__':
    main()
