import cv2
import mediapipe as mp
import time

cap = cv2.VideoCapture(0) #which camera to use, 0 is default camera

mpHands = mp.solutions.hands
hands = mpHands.Hands()
mpDraw = mp.solutions.drawing_utils


while True:
    success, img = cap.read()
    imgRGB = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    results = hands.process(imgRGB)
    print(results.multi_hand_landmarks) #prints the landmarks (x,y,z) of the detected hands

    if results.multi_hand_landmarks:
        for handLms in results.multi_hand_landmarks:
            mpDraw.draw_landmarks(img, handLms, mpHands.HAND_CONNECTIONS)# draw landmarks on the image
    
    cv2.imshow("Image", img)
    cv2.waitKey(0)