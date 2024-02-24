"""
This module contains a function to fetch messages from a Facebook conversation using the Graph API.
"""

import json
import os
from dotenv import load_dotenv
import requests

load_dotenv()

# pylint: disable=line-too-long
YOUR_USER_ID = os.environ.get("MESSENGER_ID")
OTHER_PERSON_ID = os.environ.get("TYLR_ID")
ACCESS_TOKEN = os.environ.get("PAGE_ACCESS_TOKEN")

# Use the value in your code
print(ACCESS_TOKEN)


def convert_message_to_tuning_format(original):
    """
    Convert a Facebook message to the format expected by the tuning model.
    """
    # determine the role based on the 'id' field
    user_id = OTHER_PERSON_ID

    output_format_id_based = {"messages": []}

    for item in original:
        role = "assistant" if item["from"]["id"] == user_id else "user"
        output_format_id_based["messages"].append(
            {"role": role, "content": item["message"]}
        )

    output_format_id_based["messages"].reverse()

    return output_format_id_based


def fetch_message_id(person_id):
    """
    Fetch conversation id from a Facebook conversation using the Graph API.
    """
    base_url = f"https://graph.facebook.com/v17.0/me/conversations?fields=messages{{message,from}}&user_id={person_id}&limit=25"
    print(f"base_url: {base_url}")
    params = {
        "access_token": ACCESS_TOKEN,
    }

    response = requests.get(base_url, params=params, timeout=20)
    if response.status_code == 200:
        response = response.json()
        data = response["data"]
        result = data[0]["id"]
        print(f"message id: {result}")
        return result

    print(f"Failed to fetch message id: {response.status_code}")
    return None


def fetch_messages(message_id, after_cursor):
    """
    Fetch messages from a Facebook conversation using the Graph API.
    """
    base_url = f"https://graph.facebook.com/v17.0/{message_id}/messages?fields=message,from&limit=25&after={after_cursor}"
    print(f"base_url: {base_url}")
    params = {
        "access_token": ACCESS_TOKEN,
    }

    response = requests.get(base_url, params=params, timeout=20)
    if response.status_code == 200:
        return response.json()

    print(f"Failed to fetch messages: {response.status_code}")
    return None


def download_all_messages():
    """
    Download all messages from a Facebook conversation and save them to a file.
    """
    all_messages = []
    after_cursor = None
    max_messages = 100

    message_id = fetch_message_id(OTHER_PERSON_ID)

    while True:
        result = fetch_messages(message_id, after_cursor)
        if result and "data" in result:
            all_messages.extend(result["data"])
            # Check if there's a next page
            paging = result.get("paging", {})
            cursors = paging.get("cursors", {})
            after_cursor = cursors.get("after")
            if not after_cursor:
                break  # Exit loop if there's no next page
            if len(all_messages) >= max_messages:
                break  # Exit loop if we have enough messages
        else:
            print("No messages found or request failed.")
            break  # Exit loop if request failed or data is missing

    # Convert the messages to the format expected by the tuning model
    all_messages = convert_message_to_tuning_format(all_messages)
    # Encoding to bytes, then decoding with 'unicode_escape' to interpret the sequences
    all_messages_str = json.dumps(all_messages, ensure_ascii=False)

    # save messages
    with open("facebook_messages.json", "w", encoding="utf-8") as file:
        file.write(all_messages_str)

    print(f"Downloaded {len(all_messages)} messages")


if __name__ == "__main__":
    download_all_messages()
