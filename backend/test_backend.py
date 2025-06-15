import requests
import time

# Configuration
BASE_API_URL = "http://127.0.0.1:5001/api"  # Corrected port and base path for API
BASE_OUTPUT_URL = "http://127.0.0.1:5001"   # Base URL for accessing output files
MAX_POLL_ATTEMPTS = 30  # Max number of times to poll for status (e.g., 30 attempts)
POLL_INTERVAL = 10      # Seconds between polls (e.g., 10 seconds, adjust as needed)

def print_test_header(test_name):
    print(f"\n--- Running Test: {test_name} ---")

def print_test_result(success, message=""):
    status = "PASS" if success else "FAIL"
    full_message = f"{status}: {message if message else ('Test successful.' if success else 'Test failed.')}"
    print(full_message)
    print("-------------------------------------")
    return success

def test_start_analysis():
    print_test_header("Start Analysis Endpoint (/api/start-analysis)")
    url = f"{BASE_API_URL}/start-analysis"
    task_id = None
    success = False
    try:
        # Define the prompt to be sent to the backend
        payload = {"prompt": "生成5月手卫生培训与专项考核报告"}
        print(f"Sending POST to {url} with payload: {payload}")
        response = requests.post(url, json=payload)
        print(f"POST {url} - Status Code: {response.status_code}")
        response_data = response.json()
        print(f"Response JSON: {response_data}")
        if response.status_code == 202: # Accepted
            task_id = response_data.get("task_id")
            if task_id:
                print(f"Analysis started successfully. Task ID: {task_id}")
                success = True
            else:
                print("Error: 'task_id' not found in response.")
        else:
            print(f"Error starting analysis. Details: {response_data.get('error', response.text)}")
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
    except requests.exceptions.JSONDecodeError:
        print(f"Failed to decode JSON response: {response.text}")

    print_test_result(success, f"Task ID obtained: {task_id}" if success else "Failed to start analysis.")
    return task_id if success else None

def test_analysis_status_and_completion(task_id):
    print_test_header(f"Analysis Status & Completion (Task ID: {task_id})")
    if not task_id:
        return None, print_test_result(False, "No task_id provided for status check.")

    status_url = f"{BASE_API_URL}/analysis-status/{task_id}"
    html_url_path = None
    final_status_achieved = False
    final_success = False

    for attempt in range(MAX_POLL_ATTEMPTS):
        try:
            print(f"Polling status for task {task_id}... Attempt {attempt + 1}/{MAX_POLL_ATTEMPTS}")
            response = requests.get(status_url)
            print(f"GET {status_url} - Status Code: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"Response JSON: {data}")
                current_status = data.get("status")
                message = data.get("message", "")
                print(f"Current task status: {current_status} - {message}")

                if current_status == "completed":
                    html_url_path = data.get("html_url")
                    if html_url_path:
                        print(f"Analysis completed successfully. HTML URL path: {html_url_path}")
                        final_success = True
                    else:
                        print("Error: Analysis completed but 'html_url' not found.")
                        final_success = False
                    final_status_achieved = True
                    break
                elif current_status == "failed":
                    error_details = data.get("error_details", "No error details provided.")
                    print(f"Analysis failed. Error: {error_details}")
                    final_success = False
                    final_status_achieved = True
                    break
                elif current_status in ["pending", "processing"]:
                    time.sleep(POLL_INTERVAL) # Wait before next poll
                else:
                    print(f"Unknown status received: {current_status}")
                    final_success = False
                    final_status_achieved = True
                    break
            elif response.status_code == 404:
                print(f"Error: Task ID {task_id} not found (404).")
                final_success = False
                final_status_achieved = True
                break
            else:
                print(f"Error fetching status. Status code: {response.status_code}, Response: {response.text}")
                final_success = False
                # Don't break immediately, maybe a transient server error
                time.sleep(POLL_INTERVAL)

        except requests.exceptions.RequestException as e:
            print(f"Request failed during status polling: {e}")
            final_success = False
            # Don't break immediately, maybe a transient network issue
            time.sleep(POLL_INTERVAL)
        except requests.exceptions.JSONDecodeError:
            print(f"Failed to decode JSON response during status polling: {response.text}")
            # Don't break, let it retry
            time.sleep(POLL_INTERVAL)
        
    if not final_status_achieved:
        print(f"Polling timed out after {MAX_POLL_ATTEMPTS * POLL_INTERVAL} seconds. Last known status might be '{current_status}'.")
        final_success = False

    print_test_result(final_success, f"Final status for task {task_id}: {'Completed with HTML URL' if final_success and html_url_path else ('Completed without HTML URL' if final_success else 'Failed or Timed Out')}")
    return html_url_path if final_success and html_url_path else None


def test_get_output_file(html_url_path):
    print_test_header(f"Get Output File ({html_url_path})")
    if not html_url_path:
        return print_test_result(False, "No HTML URL path provided to fetch.")

    # html_url_path from backend is like "/outputs/visualization.html"
    full_url = f"{BASE_OUTPUT_URL}{html_url_path}" # Prepend base URL
    success = False
    try:
        print(f"Attempting to GET: {full_url}")
        response = requests.get(full_url)
        print(f"GET {full_url} - Status Code: {response.status_code}")
        if response.status_code == 200:
            print(f"Successfully fetched output file. Content-Type: {response.headers.get('Content-Type')}, Length: {len(response.content)}")
            success = True
        else:
            print(f"Error fetching output file. Response: {response.text}")
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
    
    print_test_result(success, f"Successfully fetched {full_url}" if success else f"Failed to fetch {full_url}")
    return success

def test_chat_endpoint():
    print_test_header("Chat Endpoint (/api/chat)")
    url = f"{BASE_API_URL}/chat"
    success = False
    try:
        payload = {"message": "Hello from the test script!"}
        response = requests.post(url, json=payload)
        print(f"POST {url} - Status Code: {response.status_code}")
        response_data = response.json()
        print(f"Response JSON: {response_data}")
        if response.status_code == 200:
            if "reply" in response_data:
                print(f"Chat endpoint responded: {response_data['reply']}")
                success = True # Endpoint is reachable and responds as expected
            else:
                print("Error: 'reply' not found in chat response.")
        else:
            print(f"Error calling chat endpoint. Details: {response_data.get('error', response.text)}")
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
    except requests.exceptions.JSONDecodeError:
        print(f"Failed to decode JSON response from chat endpoint: {response.text}")

    print_test_result(success, "Chat endpoint test completed.")
    return success

if __name__ == "__main__":
    print("===== Starting Backend Integration Test Suite =====")
    
    # Test 1: Start Analysis
    task_id = test_start_analysis()
    
    retrieved_html_url = None
    if task_id:
        # Test 2: Poll for Analysis Status and Completion
        retrieved_html_url = test_analysis_status_and_completion(task_id)
    else:
        print("\nSkipping Analysis Status & Completion test due to failure in starting analysis.")

    if retrieved_html_url:
        # Test 3: Get Output File
        test_get_output_file(retrieved_html_url)
    elif task_id : # Only print skip if analysis was started but didn't complete successfully with a URL
        print("\nSkipping Get Output File test: Analysis did not complete successfully with an HTML URL.")

    # Test 4: Chat Endpoint
    test_chat_endpoint()
    
    print("\n===== Backend Integration Test Suite Finished =====") 