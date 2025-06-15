import os
import uuid
import threading
import subprocess
import time
import logging
import shutil # Added for file copying
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# --- Configuration ---
# Assuming this script (app.py) is in /Users/frog_wch/playground/Research/Projects/nlp/chatbot/backend/
CHATBOT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
NLP_HOMEWORK_DIR = os.path.join(CHATBOT_ROOT, "gen", "nlp-homework")
NLP_OUTPUT_DIR = os.path.join(NLP_HOMEWORK_DIR, "output")

# Attempt to determine the visualization output filename.
# Default, but we'll try to be smarter if possible or allow override.
# User confirmed that visualization.py output is not fixed, so we'll search.
# Let's stick to a primary guess and then search.
ASSUMED_VISUALIZATION_HTML_FILENAME = "visualization.html"
DUMMY_HTML_FILENAME = "dummy_visualization.html" # For the dummy task

# --- Flask App Setup ---
app = Flask(__name__)
CORS(app) # Allow all origins for simplicity in demo

# Setup logging
logging.basicConfig(level=logging.INFO)
# --- Task Management ---
# Stores task_id: {"status": "pending/processing/completed/failed", 
#                   "result_filename": None, "error": None, "message": None}
tasks = {} 

# --- Helper Function for Analysis ---
def run_analysis_scripts_for_task(task_id, user_prompt):
    try:
        current_task = tasks[task_id]
        current_task["status"] = "processing"
        current_task["message"] = "Starting analysis..."
        app.logger.info(f"Task {task_id}: Starting analysis.")

        # Ensure output directory exists (scripts might assume it does)
        if not os.path.exists(NLP_OUTPUT_DIR):
            os.makedirs(NLP_OUTPUT_DIR, exist_ok=True)
            app.logger.info(f"Task {task_id}: Created NLP_OUTPUT_DIR at {NLP_OUTPUT_DIR}")

        script_cwd = NLP_HOMEWORK_DIR
        python_executable = "python" # Or specify full path to a venv python if necessary

        # Define consistent intermediate filenames, using task_id to prevent race conditions
        raw_output_filename = "raw_output.json"
        conclusion_filename = "conclusion.json"
        mid_output_filename = "mid_output.json"
        
        # Step 1: generate_raw_output_json.py with dynamic prompt and output
        current_task["message"] = "Step 1/3: Generating raw JSON..."
        app.logger.info(f"Task {task_id}: Running generate_raw_output_json.py with prompt: '{user_prompt}'")
        script1_path = os.path.join(NLP_HOMEWORK_DIR, "generate_raw_output_json.py")
        cmd1 = [
            python_executable, 
            script1_path,
            "--prompt", user_prompt,
            "--output", raw_output_filename,
            "--conclusion_output", conclusion_filename
        ]
        process1 = subprocess.run(cmd1, cwd=script_cwd, capture_output=True, text=True, check=False, encoding='utf-8')
        if process1.returncode != 0:
            error_msg = f"generate_raw_output_json.py failed: STDOUT: {process1.stdout} STDERR: {process1.stderr}"
            app.logger.error(f"Task {task_id}: {error_msg}")
            raise Exception(error_msg)
        app.logger.info(f"Task {task_id}: generate_raw_output_json.py completed. STDOUT: {process1.stdout}")

        # Step 2: generate_mid_fromraw.py, pointing to the output of Step 1
        current_task["message"] = "Step 2/3: Generating intermediate JSON..."
        app.logger.info(f"Task {task_id}: Running generate_mid_fromraw.py")
        script2_path = os.path.join(NLP_HOMEWORK_DIR, "generate_mid_fromraw.py")
        cmd2 = [
            python_executable,
            script2_path,
            "--raw_input", raw_output_filename,
            "--conclusion_input", conclusion_filename,
            "--output", mid_output_filename 
        ]
        process2 = subprocess.run(cmd2, cwd=script_cwd, capture_output=True, text=True, check=False, encoding='utf-8')
        if process2.returncode != 0:
            error_msg = f"generate_mid_fromraw.py failed: STDOUT: {process2.stdout} STDERR: {process2.stderr}"
            app.logger.error(f"Task {task_id}: {error_msg}")
            raise Exception(error_msg)
        app.logger.info(f"Task {task_id}: generate_mid_fromraw.py completed. STDOUT: {process2.stdout}")

        # Step 3: visualization.py
        current_task["message"] = "Step 3/3: Generating visualization..."
        app.logger.info(f"Task {task_id}: Running visualization.py")
        script3_path = os.path.join(NLP_HOMEWORK_DIR, "visualization.py")
        
        # The final report will be placed in the designated output directory
        final_html_filename = ASSUMED_VISUALIZATION_HTML_FILENAME # e.g., "visualization.html"
        final_html_path = os.path.join(NLP_OUTPUT_DIR, final_html_filename)

        cmd3 = [
            python_executable,
            script3_path,
            "--input", mid_output_filename,
            "--output", final_html_path
        ]
        process3 = subprocess.run(cmd3, cwd=script_cwd, capture_output=True, text=True, check=False, encoding='utf-8')
        if process3.returncode != 0:
            error_msg = f"visualization.py failed: STDOUT: {process3.stdout} STDERR: {process3.stderr}"
            app.logger.error(f"Task {task_id}: {error_msg}")
            raise Exception(error_msg)
        app.logger.info(f"Task {task_id}: visualization.py completed. STDOUT: {process3.stdout}")
        
        # Discover the HTML file produced by visualization.py
        # Since we explicitly defined the output path, we can directly check for it.
        if os.path.exists(final_html_path):
            app.logger.info(f"Task {task_id}: Found expected HTML file: {final_html_filename}")
            current_task["result_filename"] = final_html_filename
        else:
            error_msg = f"No HTML visualization file found at the expected path: {final_html_path}"
            app.logger.error(f"Task {task_id}: {error_msg}")
            raise Exception(error_msg)
        
        current_task["status"] = "completed"
        current_task["message"] = "Analysis completed successfully."
        app.logger.info(f"Task {task_id}: Analysis completed. Result file: {final_html_filename}")

    except Exception as e:
        app.logger.error(f"Error during analysis for task {task_id}: {str(e)}", exc_info=True)
        if task_id in tasks: # Check if task_id still exists, could be removed by other logic if any
            tasks[task_id]["status"] = "failed"
            tasks[task_id]["error"] = str(e)
            tasks[task_id]["message"] = f"Analysis failed: {str(e)}"

# --- API Endpoints ---
@app.route('/api/start-analysis', methods=['POST'])
def start_analysis_endpoint():
    # Expect a JSON body with a 'prompt'
    data = request.get_json()
    if not data or 'prompt' not in data:
        return jsonify({"error": "Missing 'prompt' in request body"}), 400
    user_prompt = data['prompt']

    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "status": "pending", 
        "result_filename": None, 
        "error": None, 
        "message": "Task created, awaiting execution."
    }
    app.logger.info(f"Created task {task_id} with prompt: '{user_prompt}'")
    
    thread = threading.Thread(target=run_analysis_scripts_for_task, args=(task_id, user_prompt))
    thread.daemon = True # Allow main program to exit even if threads are running
    thread.start()
    
    return jsonify({"task_id": task_id, "message": "Analysis started."}), 202

@app.route('/api/start-dummy-analysis', methods=['POST'])
def start_dummy_analysis_endpoint():
    task_id = str(uuid.uuid4())
    
    # Prepare the dummy HTML file by copying it to the output directory
    # AND read its content to be served directly.
    dummy_html_path_in_output = os.path.join(NLP_OUTPUT_DIR, DUMMY_HTML_FILENAME)
    html_content_for_response = None

    try:
        # Ensure NLP_OUTPUT_DIR exists
        if not os.path.exists(NLP_OUTPUT_DIR):
            os.makedirs(NLP_OUTPUT_DIR, exist_ok=True)
            app.logger.info(f"Created NLP_OUTPUT_DIR at {NLP_OUTPUT_DIR} for dummy task.")

        if os.path.exists(USER_STATIC_HTML_SOURCE):
            # Read the HTML content
            with open(USER_STATIC_HTML_SOURCE, 'r', encoding='utf-8') as f:
                html_content_for_response = f.read()
            
            # Copying the file can still be useful for direct access/debugging, but not primary for API response
            shutil.copyfile(USER_STATIC_HTML_SOURCE, dummy_html_path_in_output)
            app.logger.info(f"Copied '{USER_STATIC_HTML_SOURCE}' to '{dummy_html_path_in_output}' and read its content for task {task_id}")
            
            tasks[task_id] = {
                "status": "completed",
                # "result_filename": DUMMY_HTML_FILENAME, # Keep for consistency or if direct file serving is still a fallback
                "html_content": html_content_for_response, #<<< Store actual HTML content
                "error": None,
                "message": "虚拟分析任务已完成，HTML内容已准备就绪。",
                "task_id": task_id
            }
            app.logger.info(f"Created and completed dummy task {task_id} with direct HTML content.")
            return jsonify({"task_id": task_id, "message": "虚拟分析任务已创建并立即完成，HTML内容已直接准备好。"}), 202
        else:
            app.logger.error(f"Source HTML file for dummy task not found: {USER_STATIC_HTML_SOURCE}")
            tasks[task_id] = {
                "status": "failed", 
                "result_filename": None, 
                "html_content": None,
                "error": f"源HTML文件 '{USER_STATIC_HTML_SOURCE}' 未找到。",
                "message": "创建虚拟任务失败：源文件丢失。",
                "task_id": task_id
            }
            return jsonify({"task_id": task_id, "error": "创建虚拟任务失败，源HTML文件未找到。"}), 500

    except Exception as e:
        app.logger.error(f"Error creating dummy task {task_id}: {str(e)}", exc_info=True)
        tasks[task_id] = {
            "status": "failed", 
            "result_filename": None, 
            "html_content": None,
            "error": str(e), 
            "message": f"创建虚拟任务时出错: {str(e)}",
            "task_id": task_id
        }
        return jsonify({"task_id": task_id, "error": f"创建虚拟任务时发生服务器错误: {str(e)}"}), 500

@app.route('/api/analysis-status/<task_id>', methods=['GET'])
def analysis_status_endpoint(task_id):
    task = tasks.get(task_id)
    if not task:
        app.logger.warn(f"Status requested for unknown task_id: {task_id}")
        return jsonify({"error": "Task not found"}), 404
    
    response = {
        "task_id": task_id, 
        "status": task["status"], 
        "message": task.get("message", "")
    }
    if task["status"] == "completed":
        if task.get("html_content"):
            response["html_content"] = task["html_content"]
        # Fallback or alternative for real analysis tasks if they still use result_filename
        elif task.get("result_filename"): 
            response["html_url"] = f"/outputs/{task['result_filename']}"
            
    elif task["status"] == "failed":
        response["error_details"] = task.get("error")
        
    return jsonify(response)

# Serve files from the nlp-homework/output directory
@app.route('/outputs/<path:filename>')
def serve_output_file_endpoint(filename):
    app.logger.info(f"Serving file: {filename} from {NLP_OUTPUT_DIR}")
    return send_from_directory(NLP_OUTPUT_DIR, filename, as_attachment=False)

@app.route('/api/chat', methods=['POST'])
def chat_endpoint():
    # data = request.json
    # user_message = data.get('message')
    # For OpenRouter, you'd typically use the 'openai' library with a custom base_url
    # Example:
    # from openai import OpenAI
    # client = OpenAI(
    #   base_url="https://openrouter.ai/api/v1",
    #   api_key=os.environ.get("OPENROUTER_API_KEY"),
    # )
    # completion = client.chat.completions.create( ... )
    app.logger.info("Received request to /api/chat (not yet implemented)")
    return jsonify({"reply": "Chat functionality with OpenRouter is planned but not yet fully implemented."})

# Ensure the output directory exists at startup, as scripts might rely on it.
# This is also beneficial for the dummy task if it's called before any real analysis.
if not os.path.exists(NLP_OUTPUT_DIR):
    os.makedirs(NLP_OUTPUT_DIR, exist_ok=True)
    logging.info(f"Ensured NLP_OUTPUT_DIR exists at startup: {NLP_OUTPUT_DIR}")

# --- Main ---
if __name__ == '__main__':
    # Port for the backend server
    backend_port = int(os.environ.get("FLASK_PORT", 5001))
    app.logger.info(f"Starting Flask backend server on port {backend_port}")
    app.run(debug=True, host='0.0.0.0', port=backend_port) 