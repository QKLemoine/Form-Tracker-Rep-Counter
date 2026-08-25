import numpy as np
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean

class FormEvaluator:
    def __init__(self, root_idx=23, shoulder_idx=11):
        """
        Initializes the evaluator.
        Default indices are based on MediaPipe Pose:
        23 = Left Hip (Root)
        11 = Left Shoulder (Used for scaling)
        """
        self.root_idx = root_idx
        self.shoulder_idx = shoulder_idx

    def normalize_skeleton(self, frame_data):
        """
        Translates the skeleton to be centered at the root joint
        and scales it based on torso length to make it scale-invariant.
        
        frame_data: numpy array of shape (num_joints, 2) representing (x, y) coordinates
        """
        # 1. Translation: Center at the root joint (hip)
        root_pos = frame_data[self.root_idx]
        centered_data = frame_data - root_pos
        
        # 2. Scale: Normalize by torso length (hip to shoulder)
        torso_length = np.linalg.norm(centered_data[self.shoulder_idx] - centered_data[self.root_idx])
        
        if torso_length > 1e-6:
            scaled_data = centered_data / torso_length
        else:
            scaled_data = centered_data
            
        return scaled_data

    def evaluate_rep(self, golden_rep, test_rep):
        """
        Compares a test rep against a golden ideal rep.
        
        golden_rep: shape (T_golden, num_joints, 2)
        test_rep: shape (T_test, num_joints, 2)
        """
        if len(golden_rep) == 0 or len(test_rep) == 0:
            return float('inf'), []

        # Normalize both sequences spatially frame-by-frame
        norm_golden = np.array([self.normalize_skeleton(frame) for frame in golden_rep])
        norm_test = np.array([self.normalize_skeleton(frame) for frame in test_rep])
        
        # Flatten the spatial dimensions so each frame is a 1D vector
        # Shape goes from (T, num_joints, 2) to (T, num_joints * 2)
        flat_golden = norm_golden.reshape(norm_golden.shape[0], -1)
        flat_test = norm_test.reshape(norm_test.shape[0], -1)
        
        # Compute DTW alignment cost
        # distance: total error (lower is better)
        # path: list of matched frame indices [(0,0), (1,0), (2,1)...]
        distance, path = fastdtw(flat_test, flat_golden, dist=euclidean)
        
        # Normalize the score by the length of the alignment path 
        # so longer reps don't artificially score worse
        normalized_score = distance / len(path)
        
        return normalized_score, path